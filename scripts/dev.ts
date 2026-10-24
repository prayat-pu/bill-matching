/** Run the API and the web dev server together, with prefixed output. */
import { spawn } from "node:child_process";

const targets = [
  { name: "api", color: "\u001b[36m", args: ["run", "dev", "-w", "@bill/server"] },
  { name: "web", color: "\u001b[35m", args: ["run", "dev", "-w", "@bill/web"] },
];

const children = targets.map(({ name, color, args }) => {
  // On Windows npm is a .cmd, which spawn cannot run without a shell.
  const child = spawn("npm", args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  const prefix = `${color}[${name}]\u001b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    const emitter: NodeJS.EventEmitter = stream;
    emitter.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() !== "") process.stdout.write(prefix + line + "\n");
      }
    });
  }
  return child;
});

const stopAll = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);
for (const child of children) child.on("exit", stopAll);
