import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Inlines small CSS files directly into index.html as <style> tags,
 * eliminating render-blocking stylesheet requests.
 */
function inlineCssPlugin(): Plugin {
  return {
    name: 'inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const htmlFile = bundle['index.html'];
      if (!htmlFile || htmlFile.type !== 'asset') return;

      let html = htmlFile.source as string;

      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName.endsWith('.css') && chunk.type === 'asset') {
          const escapedName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          html = html.replace(
            new RegExp(`<link[^>]+href="[^"]*${escapedName}"[^>]*>`),
            `<style>${chunk.source}</style>`,
          );
          delete bundle[fileName];
        }
      }

      htmlFile.source = html;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), inlineCssPlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
