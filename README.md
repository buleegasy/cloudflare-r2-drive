# Cloudflare R2 云盘前端

这是一个为 Cloudflare R2 存储桶设计的、外观精美且高度可视化的云盘前端项目，完全基于单个 Cloudflare Worker 运行。

## 功能特性

- **现代 UI 设计**：采用毛玻璃（Glassmorphism）美学风格，提供适合电脑端和手机端的全响应式界面。
- **直接下载**：点击任意文件即可直接触发下载。
- **单文件 Worker**：所有的核心逻辑、HTML、CSS 和 JavaScript 交互都被巧妙地内联在单个 `index.js` 文件中，结构极致简单。
- **文件信息展示**：支持动态读取 R2 存储桶，并在前端显示不同后缀匹配的专属图标、格式化后的文件大小（KB/MB/GB）以及最后修改时间。
- **空状态指引**：如果没有文件时，会优雅地显示提示性空页面。

## 部署教程 (基于 Wrangler CLI)

### 1. 安装 Wrangler
如果您还没有安装，请全局安装 Cloudflare 的命令行工具 Wrangler（需要 Node.js 环境）：
\`\`\`bash
npm install -g wrangler
\`\`\`

### 2. 登录授权
使用 Wrangler 登录您的 Cloudflare 账号：
\`\`\`bash
wrangler login
\`\`\`

### 3. 创建 R2 存储桶 (Bucket)
您需要一个名为 `my-public-drive` 的 R2 存储桶。您可以在 Cloudflare 网页控制台创建，也可以通过运行以下命令创建：
\`\`\`bash
wrangler r2 bucket create my-public-drive
\`\`\`

### 4. 部署项目到 Cloudflare
在本项目目录下，运行部署命令：
\`\`\`bash
cd /Users/chenhaoran/Documents/Antigravity/BuleeCloud/cloudflare-r2-drive
wrangler deploy
\`\`\`

### 5. 访问您的专属云盘
部署完成后，终端中将会输出一个你的专属 Workers 访问链接（例如：`https://cloudflare-r2-drive.<your-subdomain>.workers.dev`）。使用浏览器打开这个链接，您就能看到这个漂亮的云盘了！
请前往 Cloudflare 网页控制台向您的 `my-public-drive` 存储桶中上传几个文件，刷新网页即可实时看到它们被渲染出来。

## 进阶配置
如果您想要修改绑定的存储桶名称，请直接修改项目中的 `wrangler.toml` 文件：
\`\`\`toml
[[r2_buckets]]
binding = "BUCKET"
bucket_name = "您自定义的存储桶名称"
\`\`\`
