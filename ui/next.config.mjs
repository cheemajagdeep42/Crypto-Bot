/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*"
      },
      {
        source: "/__dev_reload",
        destination: "http://localhost:3001/__dev_reload"
      }
    ];
  }
};

export default nextConfig;
