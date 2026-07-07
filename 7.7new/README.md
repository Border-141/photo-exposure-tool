# 摄影曝光参数助手(PWA)

根据器材(Sony A7 IV + 24-105G / 适马 100-400)、拍摄场景和环境条件,推荐一套光圈/快门/ISO 参数组合并说明理由。纯前端实现,无后端、无联网依赖,支持离线使用和"添加到主屏幕"。

## 文件结构

```
7.7new/
├── index.html            页面骨架 + Service Worker 注册
├── style.css             相机仪表盘风格样式(移动端优先,深色)
├── app.js                核心逻辑:向导流程 + EV 曝光联动计算引擎
├── sw.js                 Service Worker(缓存优先,离线可用)
├── manifest.webmanifest  PWA 清单(standalone、竖屏、图标)
├── icons/
│   ├── icon-192.png      光圈叶片风格图标
│   └── icon-512.png
└── README.md
```

## 曝光计算逻辑说明

核心公式:`2^EV = N² / (t × S/100)`(N=光圈,t=快门秒数,S=ISO)。

1. **环境 EV**:天气给出基础 EV(晴天 15 / 多云 13 / 阴天 12 / 日出日落 10 / 夜晚 5),再叠加光线方向(逆光 -0.7 等)和能见度修正。
2. **先定光圈快门**:每个场景按需求文档的倾向先锁定光圈与快门下限(如喷气式追焦快门 ≥1/1000s、风光大景深 f/8-f/11)。
3. **ISO 最后补足**:由 EV 联动解出 ISO 并取整到标准档位,超过 3200 触发高感提示。
4. **过亮回收**:若解出的 ISO 低于 100,先收缩光圈(不超过场景允许上限),再加快快门。
5. **安全快门**:基础 1/焦距,24-105G 计入 IBIS 约 3 档收益、适马 100-400 计入 OS+IBIS 约 4 档收益,并设 1/8s 现实上限;动态追焦时凝固主体的需求优先于防抖。

## 本地预览

Service Worker 需要 HTTP 环境(直接双击 file:// 打不开 SW,但页面本身可用)。任选其一:

```bash
# Python
python -m http.server 8080
# 或 Node
npx serve .
```

然后浏览器打开 `http://localhost:8080`。手机调试可用 Chrome DevTools 的设备模拟,或让手机与电脑同网段后访问电脑 IP。

## 部署

### GitHub Pages

1. 新建仓库,把本文件夹内所有文件推到仓库根目录(或 `docs/`)。
2. 仓库 Settings → Pages → Source 选择对应分支/目录。
3. 访问 `https://<用户名>.github.io/<仓库名>/`,手机浏览器打开后"添加到主屏幕"即可。

### Netlify

1. 登录 [netlify.com](https://www.netlify.com/) → Add new site → Deploy manually。
2. 把本文件夹整个拖进上传区,几秒后得到 `https://xxx.netlify.app` 地址。

两者都自带 HTTPS,满足 PWA 安装条件。

## 更新缓存

改动任何资源后,把 `sw.js` 里的 `CACHE_NAME`(如 `exposure-helper-v1` → `v2`)递增一次,用户下次打开会自动换新缓存。

## 本期明确不做

不连接真实相机/EXIF、无账号与云同步、无历史记录、不联网查天气或定位(见需求文档第六节)。
