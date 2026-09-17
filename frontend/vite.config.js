import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // merkletreejs/keccak256 expect Node's Buffer, which the browser doesn't have.
    nodePolyfills({ include: ['buffer'] }),
  ],
})
