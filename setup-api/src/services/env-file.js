import fs from "node:fs/promises";

import { parseEnvFile, serializeEnv, validateConfig } from "../config.js";
import { envFilePath } from "../paths.js";

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

      const content = serializeEnv(validation.config);
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
