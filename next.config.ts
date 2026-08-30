import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim self-contained server for Docker/Coolify deployments.
  output: "standalone",
  // Baileys and friends use Node built-ins / dynamic requires — keep them out
  // of the bundler and load them from node_modules at runtime instead.
  serverExternalPackages: ["baileys", "pino", "qrcode"],
};

export default nextConfig;
