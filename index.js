export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.slice(1));

    if (path === '' || path === '/') {
      const list = await env.BUCKET.list();
      return new Response(generateHTML(list.objects), {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8'
        }
      });
    }

    if (request.method === 'POST' && path === 'upload') {
      const filename = request.headers.get('X-File-Name');
      if (!filename) {
        return new Response('Filename missing', { status: 400 });
      }

      const decodedFilename = decodeURIComponent(filename);

      // 10GB Limit Check
      const list = await env.BUCKET.list();
      let totalSize = 0;
      for (const obj of list.objects) {
        totalSize += obj.size;
      }

      const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10 GB
      const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);

      if (totalSize + contentLength > MAX_SIZE) {
        return new Response('Storage limit exceeded (10GB max)', { status: 413 });
      }

      await env.BUCKET.put(decodedFilename, request.body);
      return new Response('Upload successful', { status: 200 });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const object = await env.BUCKET.get(path);
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Content-Disposition', `attachment; filename="${encodeURIComponent(path.split('/').pop())}"`);

    return new Response(object.body, { headers });
  }
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function getIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();

  if (['mp4', 'mkv', 'avi', 'mov'].includes(ext)) {
    return `<svg class="file-icon" viewBox="0 0 24 24"><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14v2a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h8a2 2 0 012 2v2z"/></svg>`;
  } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return `<svg class="file-icon" viewBox="0 0 24 24"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
  } else if (['mp3', 'wav', 'flac'].includes(ext)) {
    return `<svg class="file-icon" viewBox="0 0 24 24"><path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/></svg>`;
  } else if (['pdf', 'doc', 'docx', 'txt', 'md'].includes(ext)) {
    return `<svg class="file-icon" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>`;
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return `<svg class="file-icon" viewBox="0 0 24 24"><path d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>`;
  }
  return `<svg class="file-icon" viewBox="0 0 24 24"><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>`;
}

function generateHTML(objects) {
  let listRows = '';

  if (!objects || objects.length === 0) {
    listRows = `
      <tr>
        <td colspan="3">
          <div class="empty-state">
            <svg style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.5; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
            </svg>
            <p>Your drive is completely empty</p>
          </div>
        </td>
      </tr>
    `;
  } else {
    for (const obj of objects) {
      const date = new Date(obj.uploaded);
      const formattedDate = date.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
      const icon = getIcon(obj.key);
      const size = formatBytes(obj.size);

      listRows += `
        <tr>
          <td>
            <a href="/${encodeURIComponent(obj.key)}" class="file-link" download="${obj.key}">
              ${icon}
              <span class="file-name">${obj.key}</span>
            </a>
          </td>
          <td class="size hide-mobile">${size}</td>
          <td class="date hide-mobile">${formattedDate}</td>
        </tr>
      `;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloud Drive</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #0f172a;
      --card-bg: rgba(30, 41, 59, 0.4);
      --card-border: rgba(255, 255, 255, 0.08);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --hover-bg: rgba(255, 255, 255, 0.05);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background-color: var(--bg-color);
      background-image: 
        radial-gradient(circle at 15% 50%, rgba(56, 189, 248, 0.15), transparent 25%),
        radial-gradient(circle at 85% 30%, rgba(129, 140, 248, 0.15), transparent 25%);
      background-attachment: fixed;
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 3rem 1.5rem;
    }
    
    .container {
      width: 100%;
      max-width: 900px;
      animation: fadeIn 0.8s ease-out;
      position: relative;
      z-index: 10;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .header {
      text-align: center;
      margin-bottom: 3rem;
    }
    
    .header h1 {
      font-size: 2.5rem;
      font-weight: 700;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.75rem;
      letter-spacing: -0.02em;
    }
    
    .header p {
      color: var(--text-muted);
      font-size: 1.1rem;
      font-weight: 400;
    }
    
    .file-list-container {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--card-border);
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
      position: relative;
    }

    .file-list-container.dragover {
      border-color: var(--accent);
      background: rgba(56, 189, 248, 0.1);
    }
    
    .upload-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(15, 23, 42, 0.8);
      backdrop-filter: blur(8px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
      z-index: 50;
    }
    
    .file-list-container.dragover .upload-overlay {
      opacity: 1;
    }

    .upload-overlay p {
      margin-top: 1rem;
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--accent);
    }

    .action-bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 1rem;
    }

    .upload-btn {
      background: rgba(56, 189, 248, 0.1);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 0.5rem 1.25rem;
      border-radius: 999px;
      font-family: inherit;
      font-weight: 500;
      font-size: 0.9rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s ease;
    }

    .upload-btn:hover {
      background: rgba(56, 189, 248, 0.2);
      transform: translateY(-1px);
    }

    .upload-btn:active {
      transform: translateY(0);
    }

    #upload-input {
      display: none;
    }
    
    .progress-bar-container {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 4px;
      background: rgba(255,255,255,0.1);
      display: none;
    }
    
    .progress-bar {
      height: 100%;
      width: 0%;
      background: var(--accent);
      transition: width 0.3s ease;
    }
    .file-list-container:hover {
      box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.6);
    }
    
    .file-list {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      text-align: left;
    }
    
    .file-list th, .file-list td {
      padding: 1.25rem 1.5rem;
    }
    
    .file-list th {
      color: var(--text-muted);
      font-weight: 600;
      font-size: 0.75rem;
      border-bottom: 1px solid var(--card-border);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      background: rgba(15, 23, 42, 0.4);
    }
    
    .file-list tr td {
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      transition: background-color 0.2s ease;
    }
    
    .file-list tr:last-child td {
      border-bottom: none;
    }
    
    .file-list tbody tr:hover td {
      background-color: var(--hover-bg);
    }
    
    .file-link {
      display: inline-flex;
      align-items: center;
      gap: 1rem;
      color: var(--text-main);
      text-decoration: none;
      font-weight: 500;
      font-size: 0.95rem;
      transition: color 0.2s ease, transform 0.2s ease;
    }
    
    .file-link:hover {
      color: var(--accent);
    }
    
    .file-link:active {
      transform: scale(0.98);
    }
    
    .file-name {
      word-break: break-all;
      display: inline-block;
    }
    
    .file-icon {
      width: 24px;
      height: 24px;
      flex-shrink: 0;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      color: var(--text-muted);
      transition: color 0.2s ease;
    }

    tbody tr:hover .file-icon {
      color: var(--accent);
    }
    
    .size, .date {
      color: var(--text-muted);
      font-size: 0.875rem;
      white-space: nowrap;
    }
    
    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
      color: var(--text-muted);
    }
    
    @keyframes pulse-glow {
      0%, 100% { opacity: 0.6; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.1); }
    }
    
    .glow-dot {
      position: absolute;
      width: 300px;
      height: 300px;
      background: radial-gradient(circle, rgba(56,189,248,0.1) 0%, transparent 70%);
      top: -150px;
      right: -100px;
      pointer-events: none;
      z-index: 1;
      animation: pulse-glow 8s ease-in-out infinite;
    }
    
    @media (max-width: 640px) {
      .file-list th.hide-mobile,
      .file-list td.hide-mobile {
        display: none;
      }
      
      .file-list th, .file-list td {
        padding: 1rem;
      }
      
      .header h1 {
        font-size: 2rem;
      }
      
      body {
        padding: 1.5rem 1rem;
      }
    }
  </style>
</head>
<body>
  <div class="glow-dot"></div>
  <div class="container">
    <div class="header">
      <h1>Cloud Drive</h1>
      <p>Secure, fast, and beautiful storage</p>
    </div>
    
    <div class="action-bar">
      <input type="file" id="upload-input" multiple>
      <button class="upload-btn" onclick="document.getElementById('upload-input').click()">
        <svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m14-7l-5-5m0 0l-5 5m5-5v12"/></svg>
        Upload Files
      </button>
    </div>

    <div class="file-list-container" id="drop-zone">
      <div class="upload-overlay">
         <svg style="width: 64px; height: 64px; fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
         <p>Drop files to upload</p>
      </div>
      <table class="file-list">
        <thead>
          <tr>
            <th>Name</th>
            <th class="hide-mobile">Size</th>
            <th class="hide-mobile">Last Modified</th>
          </tr>
        </thead>
        <tbody>
          ${listRows}
        </tbody>
      </table>
      <div class="progress-bar-container" id="progress-container">
         <div class="progress-bar" id="progress-bar"></div>
      </div>
    </div>
  </div>

  <script>
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('upload-input');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const uploadBtn = document.querySelector('.upload-btn');

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
    });

    dropZone.addEventListener('drop', handleDrop, false);
    fileInput.addEventListener('change', handleFileSelect, false);

    function handleDrop(e) {
      const dt = e.dataTransfer;
      const files = dt.files;
      handleFiles(files);
    }

    function handleFileSelect(e) {
      const files = e.target.files;
      handleFiles(files);
    }

    async function handleFiles(files) {
      if (files.length === 0) return;
      
      progressContainer.style.display = 'block';
      progressBar.style.width = '0%';
      uploadBtn.disabled = true;
      uploadBtn.style.opacity = '0.5';
      uploadBtn.innerText = 'Uploading...';

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const response = await fetch('/upload', {
            method: 'POST',
            headers: {
              'X-File-Name': encodeURIComponent(file.name),
              'Content-Type': file.type || 'application/octet-stream',
              'Content-Length': file.size.toString()
            },
            body: file
          });

          if (!response.ok) {
            const err = await response.text();
            throw new Error(err || 'Upload failed');
          }
          successCount++;
        } catch (error) {
          console.error('Error uploading', file.name, error);
          alert(\`Failed to upload \${file.name}: \${error.message}\`);
          failCount++;
        }
        
        // Update progress
        const percent = ((i + 1) / files.length) * 100;
        progressBar.style.width = percent + '%';
      }

      uploadBtn.disabled = false;
      uploadBtn.style.opacity = '1';
      uploadBtn.innerHTML = '<svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-right:0.5rem" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m14-7l-5-5m0 0l-5 5m5-5v12"/></svg>Upload Files';
      
      setTimeout(() => {
        progressContainer.style.display = 'none';
        if (successCount > 0) {
          window.location.reload();
        }
      }, 500);
    }
  </script>
</body>
</html>`;
}
