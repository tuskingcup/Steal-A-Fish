/// <reference types="vite/client" />
import type { SafApi } from "../shared/api";

declare global {
  interface Window {
    saf: SafApi;
  }
}
