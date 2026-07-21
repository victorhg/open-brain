/**
 * lib/llm-health.js
 *
 * Circuit breaker and health status monitor for local LLM inference.
 * Prevents synchronous hangs when the local LLM server is unreachable.
 */

import { env } from './context-assembler.js';

let circuitBroken = false;
let lastCheck = 0;
let isHealthy = true;

const CHECK_INTERVAL_MS = 60_000; // Cache status for 1 minute
const FAILURE_THRESHOLD = 3;      // Fail after 3 attempts
let failureCount = 0;

export async function checkLLMHealth() {
  const now = Date.now();
  if (now - lastCheck < CHECK_INTERVAL_MS) {
    return { isHealthy, circuitBroken };
  }

  const { LOCAL_LLM_BASE_URL } = env;
  if (!LOCAL_LLM_BASE_URL) {
    isHealthy = false;
    return { isHealthy, circuitBroken };
  }

  try {
    const url = `${LOCAL_LLM_BASE_URL.replace(/\/+$/, '')}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      isHealthy = true;
      failureCount = 0;
      circuitBroken = false;
    } else {
      throw new Error(`Health check HTTP ${res.status}`);
    }
  } catch (err) {
    failureCount++;
    isHealthy = false;
    if (failureCount >= FAILURE_THRESHOLD) {
      circuitBroken = true;
    }
  }

  lastCheck = now;
  return { isHealthy, circuitBroken };
}
