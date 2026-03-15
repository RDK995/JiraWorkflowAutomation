import fs from "node:fs/promises";

import { CONFIG_FIELDS, parseEnvFile, serializeEnv, validateConfig } from "../config.js";
import { envFilePath } from "../paths.js";

const CONFIG_FIELD_SET = new Set(CONFIG_FIELDS);

function extractUnknownEnvLines(content = "") {
  const preserved = [];

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    if (!CONFIG_FIELD_SET.has(key)) {
      preserved.push(line);
    }
  }

  return preserved;
}

export function createEnvFileService({ fsImpl = fs, envPath = envFilePath } = {}) {
  return {
    async readCurrentConfig() {
      try {
        const content = await fsImpl.readFile(envPath, "utf8");
        return {
          exists: true,
          raw: content,
          config: parseEnvFile(content)
        };
      } catch (error) {
        if (error.code === "ENOENT") {
          return {
            exists: false,
            raw: "",
            config: parseEnvFile("")
          };
        }

        throw error;
      }
    },

    async saveConfig(configInput) {
      const validation = validateConfig(configInput);
      if (!validation.isValid) {
        return {
          ...validation,
          saved: false
        };
      }

      let existingRaw = "";
      try {
        existingRaw = await fsImpl.readFile(envPath, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }

      const preservedUnknownLines = extractUnknownEnvLines(existingRaw);
      const content = [
        serializeEnv(validation.config).trimEnd(),
        preservedUnknownLines.length > 0 ? "# Preserved custom env values" : "",
        ...preservedUnknownLines,
        ""
      ]
        .filter((section, index, sections) => !(section === "" && sections[index - 1] === ""))
        .join("\n");

      await fsImpl.writeFile(envPath, content, "utf8");

      return {
        ...validation,
        saved: true,
        raw: content
      };
    }
  };
}

const defaultService = createEnvFileService();

export const readCurrentConfig = defaultService.readCurrentConfig;
export const saveConfig = defaultService.saveConfig;
