import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/planning-copilot/",
  plugins: [react()],
  build: {
    // gzip 크기 보고는 빌드 끝에 청크를 하나 더 압축해 메모리를 쓴다.
    // 메모리가 작은 환경(2GB대)에서 `npm run check`가 zlib OOM으로 멈추지 않게 끈다.
    reportCompressedSize: false
  }
});
