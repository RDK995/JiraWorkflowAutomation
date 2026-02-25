import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const {
  PORT = 3000,
  JIRA_BASE_URL,
  JIRA_USER_EMAIL,
  JIRA_API_TOKEN,
  JIRA_WEBHOOK_SECRET,
  READY_STATUS = 'Ready',
  IN_PROGRESS_STATUS = 'In Progress',
  CODEX_API_URL = 'https://api.openai.com/v1/responses',
  CODEX_API_KEY,
  CODEX_MODEL = 'gpt-5-codex',
  ASSIGNMENT_FIELD_ID,
} = process.env;

const requiredEnv = ['JIRA_BASE_URL', 'JIRA_USER_EMAIL', 'JIRA_API_TOKEN', 'CODEX_API_KEY'];
const missingEnv = requiredEnv.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  throw new Error(`Missing required env vars: ${missingEnv.join(', ')}`);
}

const app = express();
app.use(express.json());

const jiraAuthHeader = `Basic ${Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;

function hasValidSecret(req) {
  if (!JIRA_WEBHOOK_SECRET) {
    return true;
  }

  return req.header('x-jira-webhook-secret') === JIRA_WEBHOOK_SECRET;
}

function buildCodexPrompt(issue) {
  const assignmentHint = ASSIGNMENT_FIELD_ID
    ? issue.fields?.[ASSIGNMENT_FIELD_ID]
    : issue.fields?.description?.content?.[0]?.content?.[0]?.text;

  return [
    'You are an autonomous coding assistant working on a Jira assignment.',
    `Issue key: ${issue.key}`,
    `Issue summary: ${issue.fields?.summary ?? 'N/A'}`,
    `Issue URL: ${JIRA_BASE_URL}/browse/${issue.key}`,
    `Acceptance criteria or assignment details: ${assignmentHint ?? 'No explicit assignment field provided.'}`,
    '',
    'Task:',
    '- Analyze the assignment requirements.',
    '- Create or update implementation code.',
    '- Propose tests and a pull request summary.',
  ].join('\n');
}

async function fetchIssue(issueKey) {
  const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}`, {
    method: 'GET',
    headers: {
      Authorization: jiraAuthHeader,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira issue fetch failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function addIssueComment(issueKey, commentBody) {
  const response = await fetch(`${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    headers: {
      Authorization: jiraAuthHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: commentBody }],
          },
        ],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Jira comment creation failed (${response.status}): ${body}`);
  }
}

async function callCodex(issue) {
  const prompt = buildCodexPrompt(issue);

  const response = await fetch(CODEX_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CODEX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CODEX_MODEL,
      input: prompt,
      reasoning: { effort: 'medium' },
      max_output_tokens: 1800,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Codex request failed (${response.status}): ${body}`);
  }

  const data = await response.json();

  const text = data.output_text
    ?? data.output?.flatMap((item) => item.content ?? []).find((entry) => entry.type === 'output_text')?.text
    ?? 'Codex completed but returned no output text.';

  return text;
}

function wasTransitionedToInProgress(webhookEvent) {
  const fromStatus = webhookEvent?.changelog?.items?.find((item) => item.field === 'status')?.fromString;
  const toStatus = webhookEvent?.changelog?.items?.find((item) => item.field === 'status')?.toString;

  return fromStatus === READY_STATUS && toStatus === IN_PROGRESS_STATUS;
}

app.get('/health', (_, res) => {
  res.status(200).json({ status: 'ok' });
});

app.post('/webhooks/jira-transition', async (req, res) => {
  if (!hasValidSecret(req)) {
    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  if (!wasTransitionedToInProgress(req.body)) {
    return res.status(200).json({ skipped: true, reason: 'Status transition did not match Ready -> In Progress' });
  }

  const issueKey = req.body?.issue?.key;
  if (!issueKey) {
    return res.status(400).json({ error: 'Missing issue key in webhook payload' });
  }

  try {
    const issue = await fetchIssue(issueKey);
    const codexOutput = await callCodex(issue);

    await addIssueComment(
      issueKey,
      `🤖 Codex automation was triggered for this issue when it moved to ${IN_PROGRESS_STATUS}.\n\n${codexOutput.slice(0, 3000)}`,
    );

    return res.status(200).json({ processed: true, issueKey });
  } catch (error) {
    console.error('Automation error:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Jira workflow automation listening on port ${PORT}`);
});
