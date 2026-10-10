window.futurePowerOnlineAllowed = localStorage.getItem('fpai-online') === '1';
window.futurePowerPerformanceMode = localStorage.getItem('fpai-performance') || 'auto';
// Electron overrides this from the file:// page; the website keeps this empty.
window.FPAI_API_BASE = window.FPAI_API_BASE || '';
