export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname.slice(1));

    if (request.method === 'GET' && path === 'ads.txt') {
      return new Response('google.com, pub-6423202281776515, DIRECT, f08c47fec0942fa0', {
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    if (request.method === 'POST' && path === 'api/upload') {
      const filename = request.headers.get('X-File-Name');
      const currentPath = request.headers.get('X-Current-Path') || '';
      if (!filename) {
        return new Response('Filename missing', { status: 400 });
      }

      const decodedFilename = decodeURIComponent(filename);
      const fullKey = currentPath + decodedFilename;

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

      await env.BUCKET.put(fullKey, request.body);
      return new Response('Upload successful', { status: 200 });
    }

    if (request.method === 'POST' && path === 'api/trash-batch') {
      try {
        const { keys } = await request.json();
        if (!Array.isArray(keys)) return new Response('Invalid keys', { status: 400 });
        for (const key of keys) {
          if (key.endsWith('/')) {
            let listed;
            do {
              listed = await env.BUCKET.list({ prefix: key });
              for (const object of listed.objects) {
                const newKey = '.trash/' + object.key;
                const obj = await env.BUCKET.get(object.key);
                if (obj) {
                  await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
                  await env.BUCKET.delete(object.key);
                }
              }
            } while (listed.truncated);
          } else {
            const newKey = '.trash/' + key;
            const obj = await env.BUCKET.get(key);
            if (obj) {
              await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
              await env.BUCKET.delete(key);
            }
          }
        }
        return new Response('Trashed', { status: 200 });
      } catch (e) {
        return new Response('Error', { status: 500 });
      }
    }

    if (request.method === 'POST' && path === 'api/restore-batch') {
      try {
        const { keys } = await request.json();
        if (!Array.isArray(keys)) return new Response('Invalid keys', { status: 400 });
        for (const key of keys) {
          if (key.endsWith('/')) {
            let listed;
            do {
              listed = await env.BUCKET.list({ prefix: key });
              for (const object of listed.objects) {
                if (object.key.startsWith('.trash/')) {
                  const newKey = object.key.slice('.trash/'.length);
                  const obj = await env.BUCKET.get(object.key);
                  if (obj) {
                    await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
                    await env.BUCKET.delete(object.key);
                  }
                }
              }
            } while (listed.truncated);
          } else {
            if (key.startsWith('.trash/')) {
              const newKey = key.slice('.trash/'.length);
              const obj = await env.BUCKET.get(key);
              if (obj) {
                await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
                await env.BUCKET.delete(key);
              }
            }
          }
        }
        return new Response('Restored', { status: 200 });
      } catch (e) {
        return new Response('Error', { status: 500 });
      }
    }

    if (request.method === 'POST' && path === 'api/delete-batch') {
      try {
        const { keys } = await request.json();
        if (!Array.isArray(keys)) return new Response('Invalid keys', { status: 400 });
        for (const key of keys) {
          if (key.endsWith('/')) {
            let listed;
            do {
              listed = await env.BUCKET.list({ prefix: key });
              for (const object of listed.objects) {
                await env.BUCKET.delete(object.key);
              }
            } while (listed.truncated);
          } else {
            await env.BUCKET.delete(key);
          }
        }
        return new Response('Deleted', { status: 200 });
      } catch (e) {
        return new Response('Error', { status: 500 });
      }
    }

    if (request.method === 'POST' && path === 'api/rename') {
      try {
        const { oldKey, newKey } = await request.json();
        const obj = await env.BUCKET.get(oldKey);
        if (!obj) return new Response('Not Found', { status: 404 });
        await env.BUCKET.put(newKey, obj.body, { httpMetadata: obj.httpMetadata });
        await env.BUCKET.delete(oldKey);
        return new Response('Renamed', { status: 200 });
      } catch (e) {
        return new Response('Error', { status: 500 });
      }
    }



    if (request.method === 'GET' && path === 'api/list-folder') {
      const prefix = new URL(request.url).searchParams.get('prefix');
      if (!prefix) return new Response('Prefix missing', { status: 400 });
      let allObjects = [];
      let listed;
      do {
        listed = await env.BUCKET.list({ prefix });
        allObjects.push(...listed.objects.map(o => o.key));
      } while (listed.truncated);
      return new Response(JSON.stringify({ keys: allObjects }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // If it's a directory or root
    if (path === '' || path.endsWith('/')) {
      const options = { delimiter: '/' };
      if (path !== '') {
        options.prefix = path;
      }
      const list = await env.BUCKET.list(options);
      const isTrash = path.startsWith('.trash/');
      const isPartial = request.headers.get('X-Partial') === 'true';

      if (isPartial) {
        return new Response(JSON.stringify({
          rows: generateTableRows(list, path, isTrash),
          breadcrumbs: generateBreadcrumbs(path),
          path: path
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(generateHTML(list, path, isTrash), {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8'
        }
      });
    }

    const object = await env.BUCKET.get(path);
    if (!object) {
      // Maybe they forgot the trailing slash for a directory? Try to redirect.
      const testList = await env.BUCKET.list({ prefix: path + '/', limit: 1 });
      if (testList.objects.length > 0 || testList.delimitedPrefixes.length > 0) {
        return Response.redirect(url.toString() + '/', 301);
      }
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    const isPreview = url.searchParams.get('preview') === 'true';
    const filename = encodeURIComponent(path.split('/').pop());

    if (isPreview) {
      headers.set('Content-Disposition', `inline; filename="${filename}"`);
      // We explicitly don't set a forced content-type here, we can rely on R2's stored metadata
      // if it has one, or let the browser infer from the data itself.
    } else {
      headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    }

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

function getFolderIcon() {
  return `<svg class="file-icon folder-icon" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>`;
}

function generateBreadcrumbs(currentPath) {
  const homeIcon = `<svg style="width:14px;height:14px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  if (!currentPath) {
    return `<div class="breadcrumbs" data-path=""><span class="breadcrumb-pill breadcrumb-pill-current">${homeIcon}<span>Home</span></span></div>`;
  }
  const parts = currentPath.split('/').filter(Boolean);
  let breadcrumbStr = `<a href="/" class="breadcrumb-pill breadcrumb-pill-link" data-nav="true">${homeIcon}<span>Home</span></a>`;
  let pathAccumulator = '';
  for (let i = 0; i < parts.length; i++) {
    pathAccumulator += parts[i] + '/';
    breadcrumbStr += `<span class="breadcrumb-sep">›</span>`;
    if (i === parts.length - 1) {
      breadcrumbStr += `<span class="breadcrumb-pill breadcrumb-pill-current"><span>${parts[i]}</span></span>`;
    } else {
      breadcrumbStr += `<a href="/${encodeURIComponent(pathAccumulator)}" class="breadcrumb-pill breadcrumb-pill-link" data-nav="true"><span>${parts[i]}</span></a>`;
    }
  }
  return `<div class="breadcrumbs" data-path="${currentPath}">${breadcrumbStr}</div>`;
}

function generateTableRows(list, currentPath = '', isTrash = false) {
  let listRows = '';
  const objects = list.objects || [];
  const prefixes = list.delimitedPrefixes || [];

  if (currentPath !== '') {
    const pathParts = currentPath.split('/').filter(Boolean);
    const parentPath = pathParts.slice(0, -1).join('/');
    const parentHref = parentPath ? '/' + encodeURIComponent(parentPath + '/') : '/';
    const parentName = parentPath ? parentPath.split('/').pop() : 'Home';
    listRows += `
      <tr class="back-row">
        <td colspan="4">
          <a href="${parentHref}" class="back-btn" data-nav="true">
            <svg style="width:16px;height:16px;flex-shrink:0;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5m0 0l7 7m-7-7l7-7"/></svg>
            <span>Back to <strong>${parentName}</strong></span>
          </a>
        </td>
      </tr>
    `;
  }

  for (const prefix of prefixes) {
    const folderName = prefix.split('/').filter(Boolean).pop();
    listRows += `
      <tr class="folder-row" data-key="${prefix}">
        <td>
          <div class="row-content">
            <input type="checkbox" class="file-checkbox folder-checkbox" value="${prefix}" />
            <a href="/${encodeURIComponent(prefix)}" class="file-link" data-nav="true">
              ${getFolderIcon()}
              <span class="file-name">${folderName}</span>
            </a>
          </div>
        </td>
        <td class="size hide-mobile">-</td>
        <td class="date hide-mobile">-</td>
        <td>
          <div class="action-menu">
            <button class="icon-btn context-menu-btn" data-key="${prefix}" data-is-folder="true" data-is-trash="${isTrash}">
              <svg viewBox="0 0 24 24" class="menu-icon"><path d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  for (const obj of objects) {
    // R2 might list the directory placeholder object itself, skip it
    if (obj.key === currentPath) continue;

    const date = new Date(obj.uploaded);
    const formattedDate = date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const filename = obj.key.split('/').pop();
    const icon = getIcon(obj.key);
    const size = formatBytes(obj.size);

    const ext = filename.split('.').pop().toLowerCase();
    const previewableExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'mp4', 'webm', 'ogg', 'mov', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'js', 'json', 'html', 'css', 'csv', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'yaml', 'yml', 'xml', 'ini', 'toml', 'env', 'log', 'ts', 'jsx', 'tsx', 'vue', 'sql'];
    const isPreviewable = previewableExts.includes(ext);
    const anchorAttrs = isPreviewable
      ? `data-previewable="true" data-url="/${encodeURIComponent(obj.key)}?preview=true"`
      : `download="${filename}"`;

    listRows += `
      <tr class="file-row" data-key="${obj.key}">
        <td>
          <div class="row-content">
            <input type="checkbox" class="file-checkbox" value="${obj.key}" />
            <a href="/${encodeURIComponent(obj.key)}" class="file-link" ${anchorAttrs}>
              ${icon}
              <span class="file-name">${filename}</span>
            </a>
          </div>
        </td>
        <td class="size hide-mobile">${size}</td>
        <td class="date hide-mobile">${formattedDate}</td>
        <td>
          <div class="action-menu">
            <button class="icon-btn context-menu-btn" data-key="${obj.key}" data-is-folder="false" data-is-trash="${isTrash}">
              <svg viewBox="0 0 24 24" class="menu-icon"><path d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  if (listRows === '') {
    listRows = `
      <tr>
        <td colspan="4">
          <div class="empty-state">
            <svg style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.5; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
            </svg>
            <p>This folder is completely empty</p>
          </div>
        </td>
      </tr>
    `;
  }
  return listRows;
}

function generateHTML(list, currentPath = '', isTrash = false) {
  let listRows = generateTableRows(list, currentPath, isTrash);

  if (listRows === '') {
    listRows = `
      <tr>
        <td colspan="4">
          <div class="empty-state">
            <svg style="width: 48px; height: 48px; margin-bottom: 1rem; opacity: 0.5; stroke: currentColor; fill: none; stroke-width: 2;" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path>
            </svg>
            <p>This folder is completely empty</p>
          </div>
        </td>
      </tr>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="google-adsense-account" content="ca-pub-6423202281776515">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloud Drive</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6423202281776515"
     crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js"></script>
  <style>
    :root {
      --text-main: #ffffff;
      --text-muted: rgba(255, 255, 255, 0.5);
      --accent: #6366f1; /* Buleecloud Indigo */
      --accent-secondary: #ec4899; /* Buleecloud Pink */
      --bg-color: #030303;
      --glass-bg: rgba(255, 255, 255, 0.04);
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-hover: rgba(255, 255, 255, 0.1);
      --danger: #ff453a;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Outfit', sans-serif;
      background-color: var(--bg-color);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 5rem 1.5rem;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    /* Vibrant abstract mesh gradient background */
    .mesh-bg {
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      z-index: -1;
      background: 
        radial-gradient(circle at 15% 10%, rgba(20, 184, 166, 0.4) 0%, transparent 40%),
        radial-gradient(circle at 85% 20%, rgba(99, 102, 241, 0.35) 0%, transparent 40%),
        radial-gradient(circle at 50% 80%, rgba(56, 189, 248, 0.35) 0%, transparent 50%),
        radial-gradient(circle at 80% 90%, rgba(139, 92, 246, 0.3) 0%, transparent 40%);
      filter: blur(60px);
      opacity: 0.8;
      animation: mesh-shift 15s ease-in-out infinite alternate;
    }

    @keyframes mesh-shift {
      0% { transform: scale(1) translate(0, 0); }
      33% { transform: scale(1.1) translate(2%, -2%); }
      66% { transform: scale(0.95) translate(-2%, 2%); }
      100% { transform: scale(1) translate(0, 0); }
    }
    
    .container {
      width: 100%;
      max-width: 1000px;
      animation: fadeIn 1s cubic-bezier(0.2, 0.8, 0.2, 1);
      position: relative;
      z-index: 10;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    .header {
      text-align: center;
      margin-bottom: 3rem;
    }
    
    .header h1 {
      font-size: clamp(3rem, 12vw, 6.5rem);
      font-weight: 700;
      letter-spacing: -3px;
      background: linear-gradient(180deg, #fff 40%, rgba(255, 255, 255, 0.5) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
      line-height: 0.9;
    }
    
    /* Liquid Glass Class */
    .liquid-glass {
      background: var(--glass-bg);
      backdrop-filter: blur(25px) saturate(180%);
      -webkit-backdrop-filter: blur(25px) saturate(180%);
      border: 1px solid var(--glass-border);
      box-shadow: 
        0 30px 60px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.1);
      border-radius: 32px;
    }

    .action-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1rem;
      width: 100%;
      padding: 1rem 1.5rem;
    }
    
    .action-buttons {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    button {
      font-family: inherit;
    }

    .upload-btn, .batch-delete-btn {
      background: rgba(255, 255, 255, 0.05);
      color: var(--text-main);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 0.7rem 1.5rem;
      border-radius: 16px;
      font-weight: 600;
      font-size: 0.9rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
    }
    
    .upload-btn:hover, .batch-delete-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      transform: translateY(-4px) scale(1.02);
      border-color: rgba(255, 255, 255, 0.3);
      box-shadow: 0 10px 20px rgba(0,0,0,0.2);
    }
    .upload-btn:active, .batch-delete-btn:active {
      transform: translateY(0);
    }

    .batch-delete-btn {
      color: var(--danger);
      background: rgba(255, 69, 58, 0.1);
      border-color: rgba(255, 69, 58, 0.3);
      display: none;
    }
    .batch-delete-btn.visible {
      display: inline-flex;
    }
    
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.9rem;
      font-weight: 500;
      flex-wrap: wrap;
    }
    .breadcrumb-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.3rem 0.75rem;
      border-radius: 999px;
      white-space: nowrap;
      transition: background 0.2s ease, opacity 0.2s ease;
    }
    .breadcrumb-pill-link {
      color: var(--text-main);
      text-decoration: none;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.1);
    }
    .breadcrumb-pill-link:hover {
      background: rgba(255,255,255,0.18);
      border-color: rgba(255,255,255,0.25);
    }
    .breadcrumb-pill-current {
      color: var(--text-main);
      background: rgba(10,132,255,0.18);
      border: 1px solid rgba(10,132,255,0.35);
    }
    .breadcrumb-sep {
      color: rgba(255,255,255,0.3);
      font-size: 1.1rem;
      line-height: 1;
      user-select: none;
    }

    /* Back row */
    .back-row td {
      padding: 0.6rem 1.5rem !important;
      border-bottom: 1px solid rgba(255,255,255,0.08) !important;
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      color: var(--text-main);
      text-decoration: none;
      font-size: 0.92rem;
      font-weight: 500;
      padding: 0.5rem 1.2rem;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05);
      transition: all 0.3s ease;
    }
    .back-btn:hover {
      background: rgba(255,255,255,0.1);
      border-color: rgba(255,255,255,0.3);
      transform: translateX(-5px);
    }
    .back-btn strong { font-weight: 700; }
    
    .row-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    /* Apple style checkboxes */
    input[type="checkbox"] {
      appearance: none;
      -webkit-appearance: none;
      width: 1.25rem;
      height: 1.25rem;
      flex-shrink: 0;
      border: 1.5px solid rgba(255,255,255,0.4);
      border-radius: 6px;
      cursor: pointer;
      outline: none;
      transition: all 0.2s ease;
      position: relative;
      background: rgba(0,0,0,0.1);
    }
    input[type="checkbox"]:checked {
      background: var(--accent);
      border-color: var(--accent);
    }
    input[type="checkbox"]:checked::after {
      content: '';
      position: absolute;
      top: 2px; left: 6px;
      width: 4px; height: 10px;
      border: solid white;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    
    .file-list-container {
      overflow: hidden;
      transition: transform 0.3s cubic-bezier(0.25, 1, 0.5, 1), box-shadow 0.3s ease;
    }

    .file-list-container.dragover {
      transform: scale(1.02);
      border-color: var(--accent);
      box-shadow: 0 0 0 4px rgba(10, 132, 255, 0.3);
    }
    
    .upload-overlay {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
      z-index: 50;
      border-radius: 24px;
    }
    
    .file-list-container.dragover .upload-overlay {
      opacity: 1;
    }

    .upload-overlay p {
      margin-top: 1rem;
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-main);
      text-shadow: 0 2px 10px rgba(0,0,0,0.5);
    }
    
    .file-list {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    
    .file-list th, .file-list td {
      padding: 1.1rem 1.5rem;
    }
    
    .file-list th {
      color: var(--text-muted);
      font-weight: 500;
      font-size: 0.85rem;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      letter-spacing: 0.02em;
    }
    
    .file-list tr td {
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      transition: background-color 0.2s ease;
    }
    
    .file-list tr:last-child td {
      border-bottom: none;
    }
    
    .file-list tbody tr:hover td {
      background-color: var(--glass-hover);
    }
    
    .file-link {
      display: inline-flex;
      align-items: center;
      gap: 1rem;
      color: var(--text-main);
      text-decoration: none;
      font-weight: 500;
      font-size: 1rem;
      transition: opacity 0.2s ease;
    }
    
    .file-link:hover {
      opacity: 0.8;
    }
    
    .file-name {
      word-break: break-all;
      display: inline-block;
    }
    
    .file-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
      fill: none;
      stroke: var(--accent); /* Apple style uses tint color for folder/app icons */
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    
    .folder-icon {
      fill: rgba(10, 132, 255, 0.2);
    }
    
    .size, .date {
      color: var(--text-muted);
      font-size: 0.9rem;
      white-space: nowrap;
    }
    
    .empty-state {
      text-align: center;
      padding: 5rem 2rem;
      color: var(--text-muted);
    }
    
    .action-menu {
      display: flex;
      justify-content: flex-end;
    }
    
    .icon-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .icon-btn:hover {
      background: rgba(255,255,255,0.1);
      color: var(--text-main);
    }
    .menu-icon {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
    }

    #upload-input { display: none; }
    
    .upload-status-overlay {
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      border-radius: 999px;
      padding: 0.75rem 1.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      opacity: 0;
      transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      z-index: 100;
      min-width: 320px;
    }

    .upload-status-overlay.active {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }

    .upload-status-text {
      display: flex;
      justify-content: space-between;
      color: var(--text-main);
      font-size: 0.9rem;
      font-weight: 500;
    }

    .upload-speed {
      color: var(--accent);
    }

    .progress-bar-container {
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      overflow: hidden;
    }
    
    .progress-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, var(--accent), var(--accent-secondary));
      transition: width 0.1s linear;
      box-shadow: 0 0 15px var(--accent);
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
        font-size: 3.5rem;
      }
      body {
        padding: 2rem 1rem;
      }
      .liquid-glass {
        border-radius: 20px;
      }
    }

    /* Custom Modal */
    .custom-modal-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      z-index: 9999; display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
    }
    .custom-modal-overlay.active { opacity: 1; pointer-events: auto; }
    .custom-modal {
      width: 90%; max-width: 400px; padding: 2rem; border-radius: 24px;
      text-align: center; transform: scale(0.95); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .custom-modal-overlay.active .custom-modal { transform: scale(1); }
    .custom-modal h3 { margin-bottom: 1rem; font-size: 1.25rem; font-weight: 600; }
    .custom-modal p { margin-bottom: 1.5rem; color: var(--text-muted); font-size: 0.95rem; white-space: pre-wrap; line-height: 1.5; }
    .custom-modal input {
      width: 100%; padding: 0.75rem 1rem; border-radius: 12px;
      background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1);
      color: white; margin-bottom: 1.5rem; font-family: inherit; font-size: 1rem;
      outline: none; transition: border-color 0.2s; text-align: center;
    }
    .custom-modal input:focus { border-color: var(--accent); }
    .custom-modal-actions { display: flex; gap: 1rem; justify-content: center; }
    .custom-modal-actions button { flex: 1; justify-content: center; }
    
    .trash-link-corner {
      position: absolute;
      top: 1rem;
      right: 1.5rem;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 0.5rem 1rem;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.1);
      background: rgba(255,255,255,0.05);
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      z-index: 20;
    }
    .trash-link-corner:hover {
      background: rgba(255,255,255,0.15);
      color: var(--text-main);
      border-color: rgba(255,255,255,0.2);
    }
    
    /* Preview Modal */
    .preview-modal-overlay {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7); backdrop-filter: blur(15px); -webkit-backdrop-filter: blur(15px);
      z-index: 10000; display: flex; flex-direction: column;
      opacity: 0; pointer-events: none; transition: opacity 0.3s ease;
    }
    .preview-modal-overlay.active { opacity: 1; pointer-events: auto; }
    
    .preview-header {
      padding: 1rem 1.5rem;
      display: flex; justify-content: space-between; align-items: center;
      background: rgba(0,0,0,0.4); border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .preview-title { font-weight: 600; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
    
    .preview-actions { display: flex; gap: 0.75rem; align-items: center; }
    .preview-content-area {
      flex: 1; display: flex; align-items: center; justify-content: center;
      padding: 2rem; overflow: hidden;
    }
    
    .preview-content-area img, .preview-content-area video, .preview-content-area iframe {
      max-width: 100%; max-height: 100%; border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .preview-content-area iframe {
      width: 100%; height: 100%; background: white;
    }
    .preview-content-area .text-preview {
      width: 100%; height: 100%; max-width: 1200px;
      background: rgba(30, 41, 59, 0.9); border-radius: 12px;
      padding: 1.5rem; overflow: auto; color: #e2e8f0; font-family: monospace; white-space: pre-wrap;
      border: 1px solid rgba(255,255,255,0.1);
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body>
  <div class="mesh-bg"></div>
  <div class="container">
    <a href="/.trash/" class="trash-link-corner" data-nav="true">
      <svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>Trash 
    </a>
    <div class="header">
      <h1>BuleeCloud</h1>
    </div>
    
    <div class="action-bar liquid-glass">
      <div style="display:flex; align-items:center; gap: 1rem;" class="breadcrumbs-wrapper">
        ${generateBreadcrumbs(currentPath)}
      </div>
      <div class="action-buttons">
        ${isTrash ? `
        <button id="batch-restore-btn" class="upload-btn" style="display:none;">
           Restore Selected
        </button>
        <button id="batch-permanent-delete-btn" class="batch-delete-btn">
          Delete Permanently
        </button>
        ` : `
        <button id="batch-delete-btn" class="batch-delete-btn">
          <svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          Delete
        </button>
        <input type="file" id="upload-input" multiple>
        <input type="file" id="upload-folder-input" webkitdirectory directory multiple style="display:none;">
        <button class="upload-btn" onclick="document.getElementById('upload-input').click()">
          <svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m14-7l-5-5m0 0l-5 5m5-5v12"/></svg>
          Upload Files
        </button>
        <button class="upload-btn" onclick="document.getElementById('upload-folder-input').click()">
          <svg style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
          Upload Folder
        </button>
        `}
      </div>
    </div>

    <div class="file-list-container liquid-glass" id="drop-zone">
      <div class="upload-overlay">
         <svg style="width: 64px; height: 64px; fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;" viewBox="0 0 24 24"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
         <p>Drop files to upload</p>
      </div>
      <table class="file-list">
        <thead>
          <tr>
            <th>
              <div class="row-content" style="gap: 1rem;">
                <input type="checkbox" id="select-all" />
                <span>Name</span>
              </div>
            </th>
            <th class="hide-mobile">Size</th>
            <th class="hide-mobile">Last Modified</th>
            <th style="text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          ${listRows}
        </tbody>
      </table>
  <!-- Dynamic Island Upload Progress -->
  <div class="upload-status-overlay" id="upload-status-overlay">
    <div class="upload-status-text">
       <span id="upload-filename">Uploading...</span>
       <span class="upload-speed" id="upload-speed">0 MB/s - 0%</span>
    </div>
    <div class="progress-bar-container">
       <div class="progress-bar" id="progress-bar"></div>
    </div>
  </div>
    </div>
  </div>

  <div id="custom-modal-overlay" class="custom-modal-overlay">
    <div class="custom-modal liquid-glass">
      <h3 id="custom-modal-title">Title</h3>
      <p id="custom-modal-message">Message</p>
      <input type="text" id="custom-modal-input" style="display:none;" />
      <div class="custom-modal-actions">
        <button id="custom-modal-cancel" class="upload-btn" style="background: rgba(255,255,255,0.1)">Cancel</button>
        <button id="custom-modal-confirm" class="upload-btn" style="background: var(--accent); color: white; border-color: var(--accent);">OK</button>
      </div>
    </div>
  </div>

  <div id="preview-modal-overlay" class="preview-modal-overlay">
    <div class="preview-header">
      <div class="preview-title" id="preview-title">Filename.ext</div>
      <div class="preview-actions">
        <a id="preview-download-btn" class="upload-btn" style="padding: 0.4rem 1rem; font-size: 0.85rem;" download>
          <svg style="width:14px;height:14px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
          Download
        </a>
        <button id="preview-close-btn" class="icon-btn" style="background: rgba(255,255,255,0.1); width: 32px; height: 32px;">
          <svg style="width:16px;height:16px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="preview-content-area" id="preview-content-area">
      <!-- Dynamic content injected here -->
    </div>
  </div>

  <script>
    const CustomDialog = {
      show: function({ title, message, type = 'alert', defaultValue = '', confirmText = 'OK', cancelText = 'Cancel', danger = false }) {
        return new Promise((resolve) => {
          const overlay = document.getElementById('custom-modal-overlay');
          const titleEl = document.getElementById('custom-modal-title');
          const messageEl = document.getElementById('custom-modal-message');
          const inputEl = document.getElementById('custom-modal-input');
          const cancelBtn = document.getElementById('custom-modal-cancel');
          const confirmBtn = document.getElementById('custom-modal-confirm');
          
          titleEl.textContent = title;
          messageEl.textContent = message;
          
          if (type === 'prompt') {
            inputEl.style.display = 'block';
            inputEl.value = defaultValue;
            setTimeout(() => inputEl.focus(), 100);
          } else {
            inputEl.style.display = 'none';
          }
          
          if (type === 'alert') {
            cancelBtn.style.display = 'none';
          } else {
            cancelBtn.style.display = 'inline-flex';
            cancelBtn.textContent = cancelText;
          }
          
          confirmBtn.textContent = confirmText;
          if (danger) {
            confirmBtn.style.background = 'rgba(255, 69, 58, 0.2)';
            confirmBtn.style.borderColor = 'rgba(255, 69, 58, 0.5)';
            confirmBtn.style.color = 'var(--danger)';
          } else {
            confirmBtn.style.background = 'var(--accent)';
            confirmBtn.style.borderColor = 'var(--accent)';
            confirmBtn.style.color = 'white';
          }
          
          overlay.classList.add('active');
          
          const cleanup = () => {
            overlay.classList.remove('active');
            confirmBtn.onclick = null;
            cancelBtn.onclick = null;
          };
          
          confirmBtn.onclick = () => {
            cleanup();
            if (type === 'prompt') resolve(inputEl.value);
            else resolve(true);
          };
          
          cancelBtn.onclick = () => {
            cleanup();
            if (type === 'prompt') resolve(null);
            else resolve(false);
          };
        });
      }
    };

    window.customAlert = (msg) => CustomDialog.show({ title: 'Notice', message: msg, type: 'alert' });
    window.customConfirm = (msg) => CustomDialog.show({ title: 'Confirmation', message: msg, type: 'confirm', danger: true });
    window.customPrompt = (title, msg, def) => CustomDialog.show({ title: title, message: msg, type: 'prompt', defaultValue: def });

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('upload-input');
    const uploadBtn = document.getElementById('upload-input') ? document.querySelector('.upload-btn') : null;
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    const batchRestoreBtn = document.getElementById('batch-restore-btn');
    const batchPermanentDeleteBtn = document.getElementById('batch-permanent-delete-btn');
    const selectAllCheckbox = document.getElementById('select-all');
    const fileCheckboxes = document.querySelectorAll('.file-checkbox');
    
    // SPA Navigation
async function navigateTo(path, pushState = true) {
  if (pushState) history.pushState({ path }, '', path);
  try {
    const response = await fetch(path, { headers: { 'X-Partial': 'true' } });
    if (!response.ok) throw new Error('Navigation failed');
    const data = await response.json();
    document.querySelector('.file-list tbody').innerHTML = data.rows;
    document.querySelector('.breadcrumbs-wrapper').innerHTML = data.breadcrumbs;
    const selectAll = document.getElementById('select-all');
    if (selectAll) selectAll.checked = false;
    updateBatchDeleteVisibility();
  } catch (err) {
    console.error('SPA Navigation error:', err);
    if (pushState) window.location.href = path;
  }
}
async function refreshView() { await navigateTo(window.location.pathname, false); }
window.addEventListener('popstate', () => navigateTo(window.location.pathname, false));

// Event delegation for navigation links
document.addEventListener('click', (e) => {
  const navLink = e.target.closest('a[data-nav="true"]');
  if (navLink) {
    e.preventDefault();
    navigateTo(navLink.getAttribute('href'));
  }
});

// Get current path from breadcrumbs
    const breadcrumbs = document.querySelector('.breadcrumbs');
    const currentPath = breadcrumbs ? breadcrumbs.getAttribute('data-path') : '';

    // Drag and Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, preventDefaults, false);
      document.body.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false));
    ['dragleave', 'drop'].forEach(eventName => dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false));

    if (fileInput) {
      dropZone.addEventListener('drop', e => handleFiles(e.dataTransfer.files), false);
      fileInput.addEventListener('change', e => handleFiles(e.target.files), false);
    }
    const folderInput = document.getElementById('upload-folder-input');
    if (folderInput) {
      folderInput.addEventListener('change', e => handleFiles(e.target.files), false);
    }

    // Multi-select Logic
    function updateBatchDeleteVisibility() {
      const selected = document.querySelectorAll('.file-checkbox:checked');
      const hasSelection = selected.length > 0;
      if (batchDeleteBtn) {
         if (hasSelection) batchDeleteBtn.classList.add('visible');
         else batchDeleteBtn.classList.remove('visible');
      }
      if (batchRestoreBtn) {
         if (hasSelection) batchRestoreBtn.style.display = 'inline-flex';
         else batchRestoreBtn.style.display = 'none';
      }
      if (batchPermanentDeleteBtn) {
         if (hasSelection) batchPermanentDeleteBtn.classList.add('visible');
         else batchPermanentDeleteBtn.classList.remove('visible');
      }
    }

    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (e) => {
        fileCheckboxes.forEach(cb => {
          if (!cb.disabled) cb.checked = e.target.checked;
        });
        updateBatchDeleteVisibility();
      });
    }

    fileCheckboxes.forEach(cb => {
      cb.addEventListener('change', () => {
        const allChecked = Array.from(fileCheckboxes).every(c => c.checked || c.disabled);
        if (selectAllCheckbox) selectAllCheckbox.checked = allChecked;
        updateBatchDeleteVisibility();
      });
    });

    const uploadOverlay = document.getElementById('upload-status-overlay');
    const uploadFilename = document.getElementById('upload-filename');
    const uploadSpeed = document.getElementById('upload-speed');
    const progressBar = document.getElementById('progress-bar');
    // Upload Files
    async function handleFiles(files) {
      if (files.length === 0 || !uploadBtn) return;
      
      uploadOverlay.classList.add('active');
      uploadBtn.disabled = true;
      uploadBtn.style.opacity = '0.5';
      uploadBtn.innerText = 'Uploading...';

      let successCount = 0;
      let failCount = 0;
      let totalBytes = 0;
      for (let i = 0; i < files.length; i++) {
        totalBytes += files[i].size;
      }
      
      let totalLoadedBytesHistory = 0;
      let lastTotalLoaded = 0;
      let lastTime = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        uploadFilename.textContent = \`Uploading (\${i+1}/\${files.length})...\`;

        try {
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const totalLoaded = totalLoadedBytesHistory + e.loaded;
                const percent = totalBytes > 0 ? (totalLoaded / totalBytes) * 100 : 100;
                progressBar.style.width = percent + '%';
                
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000; // seconds
                if (timeDiff > 0.5) {
                  const bytesDiff = totalLoaded - lastTotalLoaded;
                  const speedBps = bytesDiff / timeDiff;
                  const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
                  uploadSpeed.textContent = \`\${speedMBps} MB/s - \${Math.round(percent)}%\`;
                  
                  lastTotalLoaded = totalLoaded;
                  lastTime = now;
                }
              }
            });

            xhr.addEventListener('load', () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                successCount++;
                totalLoadedBytesHistory += file.size;
                resolve();
              } else {
                reject(new Error(xhr.responseText || 'Upload failed'));
              }
            });

            xhr.addEventListener('error', () => reject(new Error('Network Error')));
            xhr.addEventListener('abort', () => reject(new Error('Upload Aborted')));

            xhr.open('POST', '/api/upload');
            const targetName = file.webkitRelativePath ? file.webkitRelativePath : file.name;
            xhr.setRequestHeader('X-File-Name', encodeURIComponent(targetName));
            xhr.setRequestHeader('X-Current-Path', currentPath);
            xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
            xhr.send(file);
          });
        } catch (error) {
          console.error('Error uploading', file.name, error);
          await customAlert(\`Failed to upload \${file.name}: \${error.message}\`);
          failCount++;
        }
      }

      uploadSpeed.textContent = 'Finishing...';
      setTimeout(async () => {
        uploadOverlay.classList.remove('active');
        if (successCount > 0) await refreshView();
      }, 500);
    }
    
    // Batch Actions
    if (batchDeleteBtn) {
      batchDeleteBtn.addEventListener('click', async () => {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
        if (selected.length === 0) return;
        
        batchDeleteBtn.disabled = true;
        batchDeleteBtn.innerText = 'Moving to Trash...';
        
        try {
          const res = await fetch('/api/trash-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: selected })
          });
          if (res.ok) await refreshView();
          else await customAlert('Trash failed: ' + await res.text());
        } catch (err) {
          await customAlert('Trash error: ' + err.message);
        } finally {
          batchDeleteBtn.disabled = false;
          batchDeleteBtn.innerText = 'Delete';
        }
      });
    }

    if (batchPermanentDeleteBtn) {
      batchPermanentDeleteBtn.addEventListener('click', async () => {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
        if (selected.length === 0 || !(await customConfirm(\`Permanently delete \${ selected.length } items? This cannot be undone.\`))) return;
        
        batchPermanentDeleteBtn.disabled = true;
        batchPermanentDeleteBtn.innerText = 'Deleting...';
        
        try {
          const res = await fetch('/api/delete-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: selected })
          });
          if (res.ok) await refreshView();
          else await customAlert('Delete failed: ' + await res.text());
        } catch (err) {
          await customAlert('Delete error: ' + err.message);
        } finally {
          batchPermanentDeleteBtn.disabled = false;
          batchPermanentDeleteBtn.innerText = 'Delete Permanently';
        }
      });
    }

    if (batchRestoreBtn) {
      batchRestoreBtn.addEventListener('click', async () => {
        const selected = Array.from(document.querySelectorAll('.file-checkbox:checked')).map(cb => cb.value);
        if (selected.length === 0) return;
        
        batchRestoreBtn.disabled = true;
        batchRestoreBtn.innerText = 'Restoring...';
        
        try {
          const res = await fetch('/api/restore-batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: selected })
          });
          if (res.ok) await refreshView();
          else await customAlert('Restore failed: ' + await res.text());
        } catch (err) {
          await customAlert('Restore error: ' + err.message);
        } finally {
          batchRestoreBtn.disabled = false;
          batchRestoreBtn.innerText = 'Restore Selected';
        }
      });
    }

    // Context Menu Actions (Rename / Delete)
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.context-menu-btn');
      if (btn) {
        const key = btn.getAttribute('data-key');
        const isFolder = btn.getAttribute('data-is-folder') === 'true';
        const isTrash = btn.getAttribute('data-is-trash') === 'true';
        
        if (isTrash) {
            const action = await customPrompt('Options', \`Options for \${ key }\\nType 'restore' to restore, 'delete' to permanently delete:\`, 'restore');
            if (action === 'restore') {
               const res = await fetch('/api/restore-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [key] }) });
               if (res.ok) await refreshView(); else await customAlert('Restore failed: ' + await res.text());
            } else if (action === 'delete') {
               const res = await fetch('/api/delete-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [key] }) });
               if (res.ok) await refreshView(); else await customAlert('Delete failed: ' + await res.text());
            }
        } else {
            const filename = key.split('/').pop();
            const ext = filename.split('.').pop().toLowerCase();
            const previewableExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'mp4', 'webm', 'ogg', 'mov', 'm4v', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'js', 'json', 'html', 'css', 'csv', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'yaml', 'yml', 'xml', 'ini', 'toml', 'env', 'log', 'ts', 'jsx', 'tsx', 'vue', 'sql'];
            const isPreviewable = previewableExts.includes(ext);

            let actionText = '';
            let defaultAction = '';
            if (isFolder) {
              actionText = \`Options for \${ key }\\nType 'download' to zip, 'delete' to move to trash:\`;
              defaultAction = 'download';
            } else if (isPreviewable) {
              actionText = \`Options for \${ key }\\nType 'preview' to view, 'rename' to rename, 'delete' to move to trash:\`;
              defaultAction = 'preview';
            } else {
              actionText = \`Options for \${ key }\\nType 'download' to download, 'rename' to rename, 'delete' to move to trash:\`;
              defaultAction = 'download';
            }
            
            const action = await customPrompt('Options', actionText, defaultAction);
            
            if (action === 'download' && isFolder) {
                downloadFolder(key);
            } else if (action === 'download' && !isFolder) {
                const a = document.createElement('a');
                a.href = '/' + encodeURIComponent(key);
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            } else if (action === 'preview' && !isFolder) {
                if (isPreviewable) {
                    showPreview('/' + encodeURIComponent(key) + '?preview=true', filename);
                } else {
                    await customAlert('Preview not supported for this file type. Please download to view.');
                }
            } else if (action === 'delete') {
                const res = await fetch('/api/trash-batch', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ keys: [key] })
                });
                if (res.ok) await refreshView();
                else await customAlert('Trash failed: ' + await res.text());
            } else if (action === 'rename' && !isFolder) {
                const currentName = key.split('/').pop();
                const prefix = key.substring(0, key.lastIndexOf('/') + 1);
                const newName = await customPrompt('Rename', 'Enter new name:', currentName);
                if (newName && newName !== currentName) {
                    const newKey = prefix + newName;
                    const res = await fetch('/api/rename', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ oldKey: key, newKey: newKey })
                    });
                    if (res.ok) await refreshView();
                    else await customAlert('Rename failed: ' + await res.text());
                }
            } else if (action === 'rename' && isFolder) {
                await customAlert('Folder rename is not supported.');
            }
        }
      }
    });

    // Preview Logic
    const previewModalOverlay = document.getElementById('preview-modal-overlay');
    const previewTitle = document.getElementById('preview-title');
    const previewContentArea = document.getElementById('preview-content-area');
    const previewDownloadBtn = document.getElementById('preview-download-btn');
    const previewCloseBtn = document.getElementById('preview-close-btn');

    function closePreview() {
      previewModalOverlay.classList.remove('active');
      setTimeout(() => {
        previewContentArea.innerHTML = ''; // clear content to stop audio/video
        previewDownloadBtn.href = '';
      }, 300);
    }

    previewCloseBtn.addEventListener('click', closePreview);
    previewModalOverlay.addEventListener('click', (e) => {
      if (e.target === previewModalOverlay) closePreview();
    });

    function showPreview(url, filename) {
      previewTitle.textContent = filename;
      
      const downloadUrl = url.replace('?preview=true', '');
      previewDownloadBtn.href = downloadUrl;
      previewDownloadBtn.download = filename;

      const ext = filename.split('.').pop().toLowerCase();
      let contentHtml = '';

      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) {
        contentHtml = \`<img src="\${url}" alt="\${filename}" />\`;
      } else if (['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(ext)) {
        contentHtml = \`<video src="\${url}" controls autoplay></video>\`;
      } else if (['mp3', 'wav', 'flac', 'm4a', 'aac'].includes(ext)) {
        contentHtml = \`<audio src="\${url}" controls autoplay></audio>\`;
      } else if (ext === 'pdf') {
        contentHtml = \`<iframe src="\${url}"></iframe>\`;
      } else if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
        const absoluteUrl = window.location.origin + downloadUrl;
        contentHtml = \`<iframe src="https://view.officeapps.live.com/op/embed.aspx?src=\${encodeURIComponent(absoluteUrl)}"></iframe>\`;
      } else if (['txt', 'md', 'js', 'json', 'html', 'css', 'csv', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bash', 'zsh', 'bat', 'ps1', 'yaml', 'yml', 'xml', 'ini', 'toml', 'env', 'log', 'ts', 'jsx', 'tsx', 'vue', 'sql'].includes(ext)) {
        // Fetch text content
        contentHtml = \`<div class="text-preview">Loading text...</div>\`;
        fetch(url)
          .then(res => res.text())
          .then(text => {
            const container = previewContentArea.querySelector('.text-preview');
            if (container) container.textContent = text;
          })
          .catch(err => {
            const container = previewContentArea.querySelector('.text-preview');
            if (container) container.textContent = 'Error loading text: ' + err.message;
          });
      }

      previewContentArea.innerHTML = contentHtml;
      previewModalOverlay.classList.add('active');
    }

    // Intercept clicks on file links
    document.addEventListener('click', (e) => {
      const fileLink = e.target.closest('.file-link');
      if (fileLink && fileLink.getAttribute('data-previewable') === 'true') {
        e.preventDefault();
        const url = fileLink.getAttribute('data-url');
        const filename = fileLink.querySelector('.file-name').textContent;
        showPreview(url, filename);
      }
    });

    async function downloadFolder(prefix) {
      try {
        uploadOverlay.classList.add('active');
        uploadFilename.textContent = 'Preparing...';
        uploadSpeed.textContent = 'Fetching file list...';
        progressBar.style.width = '10%';
        
        const res = await fetch('/api/list-folder?prefix=' + encodeURIComponent(prefix));
        if (!res.ok) throw new Error('Failed to list folder');
        const data = await res.json();
        const keys = data.keys;
        
        if (keys.length === 0) {
           await customAlert('Folder is empty');
           uploadOverlay.classList.remove('active');
           return;
        }

        const zipData = {};
        for (let i = 0; i < keys.length; i++) {
           const key = keys[i];
           uploadFilename.textContent = \`Downloading (\${i+1}/\${keys.length})...\`;
           progressBar.style.width = Math.max(10, (i / keys.length) * 90) + '%';
           const fileRes = await fetch('/' + encodeURIComponent(key));
           const arrayBuffer = await fileRes.arrayBuffer();
           // Remove prefix to get relative path inside zip
           const relativePath = key.startsWith(prefix) ? key.slice(prefix.length) : key;
           if (relativePath) {
              zipData[relativePath] = new Uint8Array(arrayBuffer);
           }
        }
        
        uploadFilename.textContent = 'Zipping...';
        uploadSpeed.textContent = '';
        progressBar.style.width = '95%';
        
        // Zero-dependency pure JS zip via fflate
        const zippedContent = fflate.zipSync(zipData);
        const blob = new Blob([zippedContent], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        let pName = prefix;
        if (pName.endsWith('/')) pName = pName.slice(0, -1);
        pName = pName.split('/').pop() || 'Archive';
        a.download = pName + '.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        progressBar.style.width = '100%';
        setTimeout(() => uploadOverlay.classList.remove('active'), 1000);
      } catch (err) {
        await customAlert('Download error: ' + err.message);
        uploadOverlay.classList.remove('active');
      }
    }

  </script>
</body>
</html>`;
}
