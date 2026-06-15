// Re-exports for backwards compatibility.
// All callers that import from lib/openrouter still work unchanged.
// The actual implementation now lives in lib/ai-provider.ts.
export { hasAiKey, complete, streamCompletion, parseJsonReply } from "./ai-provider";
