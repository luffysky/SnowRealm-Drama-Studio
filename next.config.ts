import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    // Remote storage (Vercel Blob) serves uploaded stills / reference images.
    remotePatterns: [{ protocol: 'https', hostname: '**.public.blob.vercel-storage.com' }],
  },
}

export default nextConfig
