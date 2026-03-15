import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

import { createDockerService } from "../src/services/docker-service.js";

function createExecFileMock(handler) {
  const mock = (file, args, options, callback) => {
    Promise.resolve(handler(file, args, options))
      .then(({ stdout = "", stderr = "" }) => callback(null, stdout, stderr))
      .catch((error) => callback(error));
  };
  mock[promisify.custom] = (file, args, options) => Promise.resolve(handler(file, args, options));
  return mock;
}

test("runDockerReadinessCheck treats unsupported docker desktop command as skipped", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/" + args[0] };
      }
      if (args[0] === "context") {
        return { stdout: "default" };
      }
      if (args[0] === "version") {
        return { stdout: "Client and Server" };
      }

      const error = new Error("unsupported");
      error.stderr = "docker: unknown command: docker desktop";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  assert.equal(result.ok, true);
  assert.equal(result.checks[1].ok, true);
  assert.equal(result.diagnosis.code, "docker_ready");
});

test("runDockerReadinessCheck classifies missing docker CLI", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which" && args[0] === "docker") {
        throw new Error("not found");
      }
      if (file === "which" && args[0] === "colima") {
        throw new Error("not found");
      }
      const error = new Error("missing");
      error.stderr = "docker: command not found";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis.code, "docker_not_installed");
});

test("runDockerReadinessCheck classifies stopped colima runtime", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/" + args[0] };
      }
      if (args[0] === "context") {
        return { stdout: "colima" };
      }
      if (file === "colima" && args[0] === "status") {
        return { stdout: "Stopped" };
      }
      if (args[0] === "version") {
        const error = new Error("down");
        error.stderr = "Cannot connect to the Docker daemon";
        throw error;
      }
      const error = new Error("unsupported");
      error.stderr = "docker: unknown command: docker desktop";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  assert.equal(result.ok, false);
  assert.equal(result.diagnosis.code, "colima_stopped");
});

test("runDockerReadinessCheck treats colima status as informational when docker works", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/" + args[0] };
      }
      if (args[0] === "context") {
        return { stdout: "colima" };
      }
      if (file === "colima" && args[0] === "status") {
        const error = new Error("not running");
        error.stderr = "FATA[0000] colima is not running";
        throw error;
      }
      if (file === "colima" && args[0] === "list") {
        return { stdout: "PROFILE    STATUS\ndefault    Stopped\n" };
      }
      if (args[0] === "version") {
        return { stdout: "Client and Server" };
      }

      const error = new Error("unsupported");
      error.stderr = "docker: unknown command: docker desktop";
      throw error;
    })
  });

  const result = await service.runDockerReadinessCheck();
  const colimaStatus = result.checks.find((check) => check.command === "colima status");
  assert.equal(result.ok, true);
  assert.equal(result.diagnosis.code, "docker_ready");
  assert.equal(colimaStatus?.ok, true);
  assert.match(colimaStatus?.output || "", /informational only/i);
});

test("getContainerStatus reports running container", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (args[0] === "ps") {
        return { stdout: "Up 3 minutes" };
      }
      return { stdout: "" };
    })
  });

  const result = await service.getContainerStatus();
  assert.equal(result.exists, true);
  assert.equal(result.running, true);
});

test("stopContainer skips removal when container does not exist", async () => {
  const calls = [];
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      calls.push(args);
      if (args[0] === "ps") {
        return { stdout: "" };
      }
      return { stdout: "removed" };
    })
  });

  const result = await service.stopContainer();
  assert.equal(result.output, "Container does not exist.");
  assert.equal(calls.length, 1);
});

test("runContainer uses configured env file path", async () => {
  let seenArgs;
  const service = createDockerService({
    envPath: "/tmp/custom.env",
    execFileImpl: createExecFileMock((file, args) => {
      seenArgs = args;
      return { stdout: "container-id" };
    })
  });

  await service.runContainer();
  assert.deepEqual(seenArgs.slice(0, 4), ["run", "--env-file", "/tmp/custom.env", "-p"]);
});

test("startColima runs colima start", async () => {
  let seen;
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      seen = { file, args };
      return { stdout: "starting" };
    })
  });

  const result = await service.startColima();
  assert.deepEqual(seen, { file: "colima", args: ["start", "--runtime", "docker"] });
  assert.equal(result.ok, true);
});

test("openDockerDesktop launches Docker on macOS", async () => {
  let seen;
  const service = createDockerService({
    platform: "darwin",
    execFileImpl: createExecFileMock((file, args) => {
      seen = { file, args };
      return { stdout: "" };
    })
  });

  const result = await service.openDockerDesktop();
  assert.deepEqual(seen, { file: "open", args: ["-a", "Docker"] });
  assert.equal(result.ok, true);
});

test("listDockerContexts returns parsed context rows", async () => {
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      if (file === "which") {
        return { stdout: "/usr/local/bin/docker" };
      }
      return { stdout: "default|true\ncolima|false\n" };
    })
  });

  const result = await service.listDockerContexts();
  assert.equal(result.ok, true);
  assert.deepEqual(result.contexts, [
    { name: "default", current: true },
    { name: "colima", current: false }
  ]);
});

test("switchDockerContext uses docker context use", async () => {
  let seen;
  const service = createDockerService({
    execFileImpl: createExecFileMock((file, args) => {
      seen = { file, args };
      return { stdout: "default" };
    })
  });

  const result = await service.switchDockerContext("default");
  assert.deepEqual(seen, { file: "docker", args: ["context", "use", "default"] });
  assert.equal(result.ok, true);
});
