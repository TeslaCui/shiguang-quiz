# 拾光题库

一个无需安装依赖即可运行的刷题软件原型，支持：

- 上传 `.txt`、`.md`、`.csv`、`.json` 或 PDF 文件
- 自动按题目编号/文本行数估算题量并生成本地题库
- 题库列表与浏览器 `localStorage` 持久化
- 单选题练习、即时判题与学习进度反馈

直接双击 `index.html` 即可使用。上传内容仅在浏览器本地读取，不会发送到服务器。

## 让手机和其他人访问

这是纯静态网页，可部署到 GitHub Pages、Vercel、Netlify 等任意静态托管服务。将整个文件夹上传后，使用平台提供的 `https://...` 网址即可在手机和其他设备打开；手机浏览器可选择“添加到主屏幕”。

本地局域网预览（电脑和手机需连接同一 Wi‑Fi）：

```bash
node -e "require('http').createServer((q,s)=>require('fs').createReadStream('.'+(q.url==='/'?'/index.html':q.url)).pipe(s)).listen(4173,'0.0.0.0')"
```

然后在手机访问电脑局域网 IP 的 `4173` 端口，例如 `http://192.168.1.8:4173`。正式分享建议使用 GitHub Pages 或 Vercel 的 HTTPS 地址。
