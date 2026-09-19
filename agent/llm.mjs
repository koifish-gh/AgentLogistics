import { CONFIG } from './config.mjs';

export class LLMClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || CONFIG.apiKey;
    this.baseUrl = (options.baseUrl || CONFIG.baseUrl).replace(/\/+$/, '');
    this.model = options.model || CONFIG.model;
    this.temperature = options.temperature ?? CONFIG.temperature;
  }

  async chat({ messages, tools, toolChoice = 'auto', temperature = this.temperature }) {
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

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LLM request failed with ${response.status}: ${text.slice(0, 500)}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!message) {
      throw new Error('LLM response did not contain a message');
    }
    return message;
  }
}
