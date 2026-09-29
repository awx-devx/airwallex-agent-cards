/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  images: { unoptimized: true },
};

// Bindings for `next dev` when using OpenNext Cloudflare.
if (process.env.NEXT_PRIVATE_WORKER || process.env.OPEN_NEXT) {
  try {
    const { initOpenNextCloudflareForDev } = await import("@opennextjs/cloudflare");
    initOpenNextCloudflareForDev();
  } catch {
    // Package not installed in some environments (AirCD Docker build).
  }
}

export default nextConfig;
