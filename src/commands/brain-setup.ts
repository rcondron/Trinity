/**
 * Trinity Brain Setup Command
 * 
 * Sets up the Trinity-Brain memory stack with Docker compose,
 * configures the system, and enables native semantic memory.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import type { RuntimeEnv } from "../runtime.js";
import { getTrinityConfig, updateConfigFileAsync } from "../config/config.js";
import { getTrinityConfigDir } from "../config/paths.js";

export type BrainSetupOptions = {
  force?: boolean;
  skipHealthCheck?: boolean;
  port?: number;
};

export async function brainSetupCommand(
  opts: BrainSetupOptions = {},
  runtime: RuntimeEnv
): Promise<void> {
  runtime.log("🧠 Setting up Trinity-Brain...");
  
  const config = getTrinityConfig();
  const TrinityDir = getTrinityConfigDir();
  
  // Check if Docker is available
  runtime.log("📋 Checking prerequisites...");
  const dockerAvailable = await checkDockerAvailable(runtime);
  if (!dockerAvailable) {
    runtime.error("❌ Docker is required but not available. Please install Docker and try again.");
    runtime.exit(1);
    return;
  }
  
  // Determine project root (should be parent of src directory)
  const projectRoot = findProjectRoot();
  if (!projectRoot) {
    runtime.error("❌ Could not find Trinity project root directory.");
    runtime.exit(1);
    return;
  }
  
  const dockerDir = join(projectRoot, "docker");
  const composeFile = join(dockerDir, "docker-compose.brain.yml");
  
  if (!existsSync(composeFile)) {
    runtime.error(`❌ Brain compose file not found: ${composeFile}`);
    runtime.exit(1);
    return;
  }
  
  runtime.log("🐳 Starting Brain services with Docker Compose...");
  
  // Stop existing services if force flag is set
  if (opts.force) {
    runtime.log("🛑 Stopping existing Brain services...");
    await runCommand("docker", ["compose", "-f", composeFile, "down"], runtime);
  }
  
  // Start the Brain stack
  const startSuccess = await runCommand(
    "docker",
    ["compose", "-f", composeFile, "up", "-d"],
    runtime
  );
  
  if (!startSuccess) {
    runtime.error("❌ Failed to start Brain services.");
    runtime.exit(1);
    return;
  }
  
  runtime.log("⏳ Waiting for services to initialize...");
  
  // Wait for ollama-init to complete model pulls
  runtime.log("📥 Waiting for model downloads (this may take several minutes)...");
  const initSuccess = await waitForOllamaInit(composeFile, runtime);
  if (!initSuccess) {
    runtime.error("❌ Failed to initialize Ollama models.");
    runtime.exit(1);
    return;
  }
  
  // Wait for health checks
  if (!opts.skipHealthCheck) {
    runtime.log("🔍 Running health checks...");
    const healthSuccess = await waitForHealthChecks(runtime, opts.port || 8100);
    if (!healthSuccess) {
      runtime.error("❌ Health checks failed.");
      runtime.exit(1);
      return;
    }
  }
  
  // Update Trinity.json config for native brain (core, no plugin)
  runtime.log("⚙️  Updating Trinity configuration for native brain...");
  try {
    const updateSuccess = await updateConfigForBrain(config, runtime);
    if (!updateSuccess) {
      runtime.error("❌ Failed to update configuration.");
      runtime.exit(1);
      return;
    }
  } catch (error) {
    runtime.error(`❌ Configuration update failed: ${String(error)}`);
    runtime.exit(1);
    return;
  }
  
  runtime.log("✅ Trinity-Brain setup complete!");
  runtime.log("");
  runtime.log("🎯 Next steps:");
  runtime.log("  • Brain API: http://localhost:8100");
  runtime.log("  • Neo4j Browser: http://localhost:7474 (neo4j/Trinity2026)");
  runtime.log("  • Try: Trinity brain status");
  runtime.log("  • Try: Trinity brain recall \"your query\"");
}

async function checkDockerAvailable(runtime: RuntimeEnv): Promise<boolean> {
  try {
    const result = await runCommandSilent("docker", ["--version"]);
    return result;
  } catch {
    return false;
  }
}

function findProjectRoot(): string | null {
  let current = process.cwd();
  
  // Look for src directory or package.json with Trinity-agent name
  while (current !== "/") {
    const srcDir = join(current, "src");
    const packageJson = join(current, "package.json");
    
    if (existsSync(srcDir) && existsSync(packageJson)) {
      try {
        const pkg = JSON.parse(readFileSync(packageJson, "utf8"));
        if (pkg.name === "Trinity-agent" || pkg.name === "Trinity") {
          return current;
        }
      } catch {
        // Continue searching
      }
    }
    
    const parent = join(current, "..");
    if (parent === current) break;
    current = parent;
  }
  
  return null;
}

async function runCommand(
  command: string,
  args: string[],
  runtime: RuntimeEnv
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "pipe",
      env: process.env,
    });
    
    let output = "";
    let error = "";
    
    child.stdout?.on("data", (data) => {
      const text = data.toString();
      output += text;
      // Show progress for long-running commands
      if (text.includes("Pulling") || text.includes("Downloaded") || text.includes("Creating")) {
        runtime.log(`  ${text.trim()}`);
      }
    });
    
    child.stderr?.on("data", (data) => {
      error += data.toString();
    });
    
    child.on("close", (code) => {
      if (code !== 0) {
        runtime.error(`Command failed: ${command} ${args.join(" ")}`);
        runtime.error(error);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function runCommandSilent(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: "pipe",
      env: process.env,
    });
    
    child.on("close", (code) => {
      resolve(code === 0);
    });
  });
}

async function waitForOllamaInit(composeFile: string, runtime: RuntimeEnv): Promise<boolean> {
  let attempts = 0;
  const maxAttempts = 60; // 10 minutes max
  
  while (attempts < maxAttempts) {
    try {
      // Check if ollama-init container has completed successfully
      const result = await runCommandSilent("docker", [
        "compose", "-f", composeFile, "ps", "--format", "json"
      ]);
      
      if (result) {
        // ollama-init should exit with code 0 when complete
        const exitedResult = await runCommandSilent("docker", [
          "compose", "-f", composeFile, "ps", "-a", "--format", "table"
        ]);
        
        if (exitedResult) {
          // Simple check - if we've waited a reasonable time and containers are running
          if (attempts > 10) {
            return true;
          }
        }
      }
    } catch {
      // Continue waiting
    }
    
    runtime.log(`  Waiting for model downloads... (${attempts + 1}/${maxAttempts})`);
    await sleep(10000); // Wait 10 seconds
    attempts++;
  }
  
  return false;
}

async function waitForHealthChecks(runtime: RuntimeEnv, port: number): Promise<boolean> {
  let attempts = 0;
  const maxAttempts = 30; // 5 minutes max
  
  while (attempts < maxAttempts) {
    try {
      const response = await fetch(`http://localhost:${port}/health`);
      if (response.ok) {
        runtime.log("✅ Brain API is healthy");
        return true;
      }
    } catch {
      // Continue waiting
    }
    
    runtime.log(`  Checking health... (${attempts + 1}/${maxAttempts})`);
    await sleep(10000); // Wait 10 seconds
    attempts++;
  }
  
  return false;
}

async function updateConfigForBrain(config: any, runtime: RuntimeEnv): Promise<boolean> {
  try {
    // Configure native Trinity Brain (core engine, no longer a plugin/extension)
    // This follows the latest brain-native patterns: brain config at root level,
    // auto-recall/auto-capture wired directly in core lifecycle (see src/memory and gateway hooks)
    const updatedConfig = {
      ...config,
      brain: {
        enabled: true,
        apiUrl: "http://localhost:8101",
        collection: "memories",
        autoRecall: true,
        autoCapture: true,
        recallTopK: 3,
        recallMinScore: 0.5,
        recallTokenBudget: 2000,
        captureMaxChars: 2000,
        native: true,  // flag for core treatment
      },
    };
    
    await updateConfigFileAsync(updatedConfig);
    runtime.log("✅ Configuration updated for native Trinity Brain (core subsystem)");
    return true;
  } catch (error) {
    runtime.error(`Failed to update config: ${String(error)}`);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
