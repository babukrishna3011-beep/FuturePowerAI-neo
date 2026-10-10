/* FuturePowerAIPlus 3.0 - two-model local AI engine. */

import { pipeline, env } from '@huggingface/transformers';

const FAST_MODEL = 'onnx-community/SmolLM2-135M-Instruct-ONNX';
const DEEP_MODEL = 'HuggingFaceTB/SmolLM2-1.7B-Instruct';
const MODEL_DTYPE = 'q4';
const DEEP_DTYPE = 'q4f16';
const WASM_DTYPE = 'q4';

try {
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = new URL('../node_modules/onnxruntime-web/dist/', import.meta.url).href;
    env.backends.onnx.wasm.numThreads = 1;
  }
} catch (_) {}

// Transformers.js caches remote model files in the browser/Electron cache.
env.useBrowserCache = true;
env.allowRemoteModels = true;
env.allowLocalModels = false;

let fastPipe = null;
let deepPipe = null;
let fastLoading = null;
let deepLoading = null;
let lastError = null;

function emitStatus(model, message, state = 'info', extra = {}) {
  try {
    window.dispatchEvent(new CustomEvent('futurepower-local-ai-status', {
      detail: { model, message, state, ...extra }
    }));
  } catch (_) {}
  console.info(`[FuturePowerAIPlus ${model}] ${message}`);
}

function deviceInfo() {
  return {
    webGPU: typeof navigator !== 'undefined' && !!navigator.gpu,
    cores: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2,
    deviceMemoryGB: typeof navigator !== 'undefined' ? navigator.deviceMemory || 0 : 0
  };
}

function profileForDevice() {
  const d = deviceInfo();
  if (!d.webGPU || (d.deviceMemoryGB && d.deviceMemoryGB <= 4) || d.cores <= 4) {
    return {
      name: 'Saver',
      context: 1536,
      fastTokens: 192,
      deepTokens: 320,
      ttc: 1,
      decompose: false,
      scout: false
    };
  }
  if ((d.deviceMemoryGB && d.deviceMemoryGB >= 12) || d.cores >= 12) {
    return {
      name: 'Performance',
      context: 4096,
      fastTokens: 256,
      deepTokens: 640,
      ttc: 3,
      decompose: true,
      scout: true
    };
  }
  return {
    name: 'Balanced',
    context: 3072,
    fastTokens: 224,
    deepTokens: 480,
    ttc: 2,
    decompose: true,
    scout: false
  };
}

function selectedProfile() {
  try {
    const requested = window.futurePowerPerformanceMode;
    if (requested === 'saver') {
      return { name: 'Saver', context: 1536, fastTokens: 192, deepTokens: 320, ttc: 1, decompose: false, scout: false };
    }
    if (requested === 'performance') {
      return { name: 'Performance', context: 4096, fastTokens: 256, deepTokens: 640, ttc: 3, decompose: true, scout: true };
    }
  } catch (_) {}
  return profileForDevice();
}

function taskFor(message) {
  const s = String(message || '').trim().toLowerCase();

  if (/\b(code|coding|program|programming|javascript|typescript|python|java|c\+\+|c#|html|css|sql|api|debug|debugging|bug|error|function|class|algorithm|regex|script|developer|software|github|json|node|npm|electron|webgpu|react)\b/.test(s)) {
    return 'deep';
  }

  if (/\b(jee|neet|board|cbse|solve|derive|prove|equation|quadratic|calculus|integral|integrate|derivative|differentiate|matrix|vector|probability|permutation|combination|trigonometry|geometry|algebra|numerical|factorize|factorise|simplify|mole|stoichiometry|organic|inorganic|mechanics|electrostatics|genetics|biology)\b/.test(s)) {
    return 'deep';
  }

  if (/[=^ΓêÜΓê½╬ú╧Ç%]/.test(s) && /\d/.test(s)) return 'deep';
  if (s.length > 550 || /\b(essay|report|research|chapter|detailed|compare|comparison|summarize|summarise|rewrite|long answer|explain in detail)\b/.test(s)) return 'deep';
  return 'fast';
}

function hasWebGPU() {
  return false; // temporary runtime isolation
  return typeof navigator !== 'undefined' && !!navigator.gpu;
}

async function chooseDevice() {
  if (!hasWebGPU()) return 'wasm';
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch (_) {
    return 'wasm';
  }
}

async function makePipeline(modelName, key) {
  const device = await chooseDevice();
  const runtimeDType = key === 'deep' ? DEEP_DTYPE : MODEL_DTYPE;
  const common = {
    dtype: runtimeDType,
    device
  };

  emitStatus(key, `Loading ${key === 'fast' ? 'SmolLM2-135M' : 'SmolLM2-1.7B'} (${MODEL_DTYPE}) on ${device}...`, 'loading', { device });

  try {
    return await pipeline('text-generation', modelName, common);
  } catch (firstError) {
    if (device !== 'webgpu') throw firstError;
    emitStatus(key, 'WebGPU model load failed; retrying with CPU/WASM.', 'warning', { error: String(firstError?.message || firstError) });
    return pipeline('text-generation', modelName, { dtype: key === 'deep' ? DEEP_DTYPE : MODEL_DTYPE, device: 'wasm' });
  }
}

async function loadFast() {
  if (fastPipe) return fastPipe;
  if (fastLoading) return fastLoading;
  fastLoading = makePipeline(FAST_MODEL, 'fast')
    .then(pipe => { fastPipe = pipe; emitStatus('fast', 'Fast model ready.', 'ready'); return pipe; })
    .catch(err => { lastError = err; fastPipe = null; throw err; })
    .finally(() => { fastLoading = null; });
  return fastLoading;
}

async function loadDeep() {
  if (deepPipe) return deepPipe;
  if (deepLoading) return deepLoading;
  deepLoading = makePipeline(DEEP_MODEL, 'deep')
    .then(pipe => { deepPipe = pipe; emitStatus('deep', 'Deep model ready.', 'ready'); return pipe; })
    .catch(err => { lastError = err; deepPipe = null; throw err; })
    .finally(() => { deepLoading = null; });
  return deepLoading;
}

function messages(system, user) {
  return [
    { role: 'system', content: system },
    { role: 'user', content: String(user || '').trim() }
  ];
}

function extract(output) {
  const generated = output?.[0]?.generated_text;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return String(last?.content ?? last ?? '').trim();
  }
  return String(generated ?? '').trim();
}

async function generate(pipe, system, user, maxNewTokens, profile) {
  const output = await pipe(messages(system, user), {
    max_new_tokens: Math.min(maxNewTokens, Math.max(64, profile.context - 256)),
    do_sample: false,
    no_repeat_ngram_size: 3,
    return_full_text: false
  });
  return extract(output);
}

function isCode(text) {
  return /```|function\s+\w+|const\s+\w+\s*=|class\s+\w+|import\s+.+\s+from\s+|#include\s*</.test(text);
}

function hardEnough(text) {
  const s = String(text || '');
  return s.length > 260 || /\b(jee|neet|prove|derive|debug|implement|build|refactor|solve|calculate|integrate|differentiate|algorithm|database|api)\b/i.test(s);
}

async function retrieveContext(query) {
  try {
    if (typeof window.localKnowledgeSearch === 'function') {
      const rows = await window.localKnowledgeSearch(query, 6);
      if (Array.isArray(rows) && rows.length) {
        return rows.map((r, i) => `[Source ${i + 1}] ${r.text || r}`).join('\n');
      }
    }
  } catch (error) {
    emitStatus('knowledge', 'Local knowledge retrieval skipped.', 'warning', { error: String(error?.message || error) });
  }
  return '';
}

async function deepReason(message, profile) {
  const original = String(message).trim();
  const knowledge = await retrieveContext(original);
  let working = original;

  let scout = '';
  if (profile.scout && hardEnough(original)) {
    try {
      const fast = await loadFast();
      scout = await generate(
        fast,
        'You are a lightweight study scout. Identify the topic, key entities, formulas or constraints, and likely pitfalls. Do not solve the task fully.',
        original,
        120,
        profile
      );
    } catch (_) {}
  }

  let plan = '';
  if (profile.decompose && hardEnough(original)) {
    const deep = await loadDeep();
    plan = await generate(
      deep,
      'You are the planning stage of a reliable assistant. Decompose the user task into 3-6 concrete steps. For mathematics or science, identify the governing concepts/formulas. For coding, identify modules and interfaces. Do not give the final answer yet.',
      original + (knowledge ? `\n\nRelevant local knowledge:\n${knowledge}` : '') + (scout ? `\n\nFast scout notes:\n${scout}` : ''),
      180,
      profile
    );
  }

  const deep = await loadDeep();
  working = [
    `USER TASK:\n${original}`,
    plan ? `\nPLAN:\n${plan}` : '',
    knowledge ? `\nLOCAL KNOWLEDGE:\n${knowledge}` : '',
    scout ? `\nSCOUT NOTES:\n${scout}` : ''
  ].join('\n');

  let answer = await generate(
    deep,
    'You are FuturePowerAIPlus Deep, a careful local study and coding assistant. Solve the task directly. Prefer exact reasoning over confident guessing. For quantitative problems, show the essential steps and check units/signs. For JEE/NEET/CBSE questions, use the supplied local knowledge when relevant and distinguish it from your own reasoning. For coding, produce practical code only when requested and consider edge cases.',
    working,
    profile.deepTokens,
    profile
  );

  // TTC: critique and correction using the same stronger model.
  for (let pass = 0; pass < profile.ttc; pass += 1) {
    const critique = await generate(
      deep,
      'You are a strict verifier. Check the candidate answer for factual, mathematical, logical, formatting, and requirement errors. Return either OK or a concise list of concrete corrections. Do not invent problems.',
      `ORIGINAL:\n${original}\n\nCANDIDATE:\n${answer}`,
      180,
      profile
    );

    if (!critique || /^ok\.?$/i.test(critique.trim())) break;

    answer = await generate(
      deep,
      'You are the correction stage. Rewrite the candidate answer using the verifier feedback. Preserve correct work, fix identified errors, and return only the improved answer.',
      `ORIGINAL:\n${original}\n\nCANDIDATE:\n${answer}\n\nVERIFIER FEEDBACK:\n${critique}`,
      profile.deepTokens,
      profile
    );
  }

  // Code checking: do a final review pass without executing arbitrary generated code.
  if (isCode(answer)) {
    const review = await generate(
      deep,
      'You are a secure code reviewer. Check the generated code for syntax-level mistakes, obvious logic bugs, unsafe patterns, missing error handling, and mismatch with the request. Do not execute it. If it is sound, say OK. Otherwise list the exact fixes needed.',
      `REQUEST:\n${original}\n\nCODE:\n${answer}`,
      220,
      profile
    );
    if (review && !/^ok\.?$/i.test(review.trim())) {
      answer = await generate(
        deep,
        'You are the final code-fix stage. Apply only justified fixes from the code review and return the corrected code/answer. Do not add unrelated features.',
        `REQUEST:\n${original}\n\nCURRENT ANSWER:\n${answer}\n\nCODE REVIEW:\n${review}`,
        profile.deepTokens,
        profile
      );
    }
  }

  return answer;
}

window.localAIStatus = () => ({
  available: true,
  fastLoaded: Boolean(fastPipe),
  deepLoaded: Boolean(deepPipe),
  fastModel: FAST_MODEL,
  deepModel: DEEP_MODEL,
  dtype: MODEL_DTYPE,
  device: deviceInfo(),
  profile: selectedProfile(),
  lastError: lastError ? String(lastError?.message || lastError) : null
});

window.localAISelectModel = taskFor;
window.localAIProfile = selectedProfile;
window.preloadLocalAI = async (model = 'fast') => model === 'deep' ? loadDeep() : loadFast();

window.localAskAI = async function (message) {
  const text = String(message || '').trim();
  if (!text) return '';

  const selected = taskFor(text);
  const profile = selectedProfile();
  emitStatus(selected, `Routing to ${selected === 'deep' ? 'Deep 1.7B' : 'Fast 135M'} • ${profile.name} profile.`, 'routing');

  try {
    if (selected === 'fast') {
      const pipe = await loadFast();
      return await generate(
        pipe,
        'You are FuturePowerAIPlus Fast, a friendly lightweight assistant. Be concise, clear and useful. This model is primarily intended for English; do not pretend to support languages you do not handle reliably.',
        text,
        profile.fastTokens,
        profile
      );
    }
    return await deepReason(text, profile);
  } catch (error) {
    lastError = error;
    emitStatus(selected, `${selected === 'deep' ? 'Deep' : 'Fast'} model failed.`, 'error', { error: String(error?.message || error) });
    if (selected === 'deep') {
      try {
        const fast = await loadFast();
        return await generate(
          fast,
          'You are FuturePowerAIPlus Fast. Provide the best concise answer you can, and clearly state uncertainty when the task exceeds your capability.',
          text,
          profile.fastTokens,
          profile
        );
      } catch (_) {}
    }
    throw error;
  }
};

emitStatus('system', 'Two-model local engine initialized.', hasWebGPU() ? 'ready' : 'warning', { device: deviceInfo() });


