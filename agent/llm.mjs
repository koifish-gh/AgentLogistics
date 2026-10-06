import { CONFIG } from './config.mjs';

export class LLMClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || CONFIG.apiKey;
    this.baseUrl = (options.baseUrl || CONFIG.baseUrl).replace(/\/+$/, '');
    this.model = options.model || CONFIG.model;
    this.temperature = options.temperature ?? CONFIG.temperature;
  }

  async chat({ messages, tools, toolChoice = 'auto', temperature = this.temperature, timeoutMs = 0 }) {
    if (!this.apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not set. Set it, or use AGENT_MODE=rule for the offline fallback.',
      );
    }

    const body = {
      model: this.model,
      messages,
      temperature,
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = toolChoice;
    }
    if (/glm-5/i.test(this.model)) body.reasoning_effort = 'low';

    let response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new Error('大模型请求超时');
      }
      throw error;
    }

    if (!response.ok) {
      const text = await response.text();
      let detail = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text);
        detail = parsed.error?.message || parsed.message || detail;
      } catch {
        // Keep the raw response excerpt when the provider does not return JSON.
      }
      throw new Error(`大模型请求失败（${response.status}）：${detail}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('LLM response did not contain a message');
    }
    return message;
  }
}
