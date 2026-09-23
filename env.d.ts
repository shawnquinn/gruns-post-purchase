/// <reference types="vite/client" />
/// <reference types="@react-router/node" />

declare namespace NodeJS {
  interface ProcessEnv {
    OPENAI_API_KEY?: string;
    SHOP?: string;
  }
}
