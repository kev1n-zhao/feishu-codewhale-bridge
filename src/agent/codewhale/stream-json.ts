import type { AgentEvent } from '../types';

/**
 * Raw event shape from codewhale exec --output-format stream-json.
 *
 * codewhale exec uses "type" as the sole discriminator (NOT the protocol
 * EventFrame enum which uses `#[serde(tag = "event")]`).
 *
 * Known event types:
 *   content         — plain text delta (content = text chunk)
 *   reasoning       — thinking delta (content = text chunk)
 *   tool_call       — tool invocation started (tool_id, tool_name, input)
 *   tool_result     — tool execution result (tool_id, content)
 *   session_capture — session-id captured after a turn (content = session uuid)
 *   metadata        — epilogue with model/usage/session info
 *   error           — CLI-level error
 *   done            — stream end sentinel
 */
interface CodewhaleRawEvent {
  type?: string;
  content?: string;
  tool_id?: string;
  tool_name?: string;
  input?: unknown;
  output?: unknown;
  meta?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    session_id?: string;
    status?: string;
  };
  error?: string;
}

export function* translateCodewhaleEvent(raw: unknown): Generator<AgentEvent> {
  if (!raw || typeof raw !== 'object') return;
  const evt = raw as CodewhaleRawEvent;
  if (!evt.type) return;

  switch (evt.type) {
    case 'content':
      if (evt.content) yield { type: 'text', delta: evt.content };
      return;

    case 'reasoning':
      if (evt.content) yield { type: 'thinking', delta: evt.content };
      return;

    case 'tool_call':
      if (evt.tool_name) {
        yield { type: 'tool_use', id: evt.tool_id ?? evt.tool_name, name: evt.tool_name, input: evt.input };
      }
      return;

    case 'tool_result':
      if (evt.tool_name) {
        const outputText = typeof evt.output === 'string' ? evt.output : JSON.stringify(evt.output);
        yield { type: 'tool_result', id: evt.tool_id ?? evt.tool_name, output: outputText, isError: false };
      }
      return;

    case 'session_capture':
      // Emit system event so bridge saves session for future --resume
      yield { type: 'system', sessionId: evt.content };
      return;

    case 'metadata':
      // Informational only
      return;

    case 'error':
      yield { type: 'error', message: evt.error || 'unknown error' };
      return;

    case 'done':
      yield { type: 'done' };
      return;

    default:
      return;
  }
}
