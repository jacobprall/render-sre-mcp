import {
  RenderAuthError,
  RenderNetworkError,
  RenderRateLimitError,
  RenderTimeoutError,
} from '../api/errors.js';
import type { ToolCallResult } from '../types.js';

export function errorResult(message: string): ToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function handleError(err: unknown): ToolCallResult {
  if (err instanceof RenderAuthError) {
    return errorResult(
      'Render API authentication failed. Check that RENDER_API_KEY is valid and has sufficient permissions.'
    );
  }
  if (err instanceof RenderNetworkError || err instanceof RenderTimeoutError) {
    return errorResult(
      'Render API unreachable. Cannot complete this operation. Please try again later.'
    );
  }
  if (err instanceof RenderRateLimitError) {
    return errorResult('Render API rate limit exceeded. Please wait a moment and try again.');
  }

  const message = err instanceof Error ? err.message : String(err);
  if (message.includes('401') || message.includes('Unauthorized')) {
    return errorResult(
      'Render API authentication failed. Check that RENDER_API_KEY is valid and has sufficient permissions.'
    );
  }
  if (message.includes('429')) {
    return errorResult('Render API rate limit exceeded. Please wait a moment and try again.');
  }
  return errorResult(`Error: ${message}`);
}
