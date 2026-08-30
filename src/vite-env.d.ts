/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAME_WS_URL: string;
  readonly VITE_API_BASE: string;
  readonly VITE_ASSET_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
