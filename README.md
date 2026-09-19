# The Potter Cabinet · 比得兔收藏柜

一个可在自己电脑上运行的 React 收藏应用，收录 **103 款 Beswick Beatrix Potter 动作／场景**，包含100张参考图片。

- 未收集的瓷偶显示黑白，点亮后恢复彩色，自动统计进度。
- 按名称／动作搜索，查看全部、已收藏或待收集款式。
- 每款可以记录多件实物，添加照片、日期、购入价格与币种、来源、品相和笔记。
- 实物照片支持放大查看。照片和记录保存到运行应用的电脑，刷新或关闭网页不会丢失。
- 支持导出和合并恢复包含照片的JSON备份。GitHub只存放应用代码和图鉴参考素材。

## 在电脑上启动

安装 **Node.js 22.12 或以上版本**（建议 Node.js 24 LTS），下载本仓库并进入项目目录：

```bash
npm ci
npm run build
npm start
```

打开 **http://localhost:3000**。保持运行命令的终端窗口开启；下次只需 `npm start`。按 `Ctrl+C` 正常退出。

开发修改时运行 `npm run dev`，同样打开 http://localhost:3000，React 会自动刷新。

测试：`npm test`。测试只使用临时目录，不改动真实收藏。

## 数据与备份

第一次启动会创建：

```text
data/
  collection.json            收藏档案
  collection.json.previous   上一次成功保存之前的档案
  uploads/                   自己的实物照片
```

请保留整个 `data` 目录。它默认不提交到Git，也不随代码升级被删除。不要同时启动两个指向同一数据目录的实例；应用会拒绝第二个实例，防止互相覆盖。若异常退出后提示存在旧锁，运行 `npm run unlock`；该命令只会在原进程已停止时清理锁，然后可重新启动。

网页右上角“收藏备份”可以导出记录与照片。备份合并恢复会更新相同实物编号的资料，并保留其他本地实物；已点亮状态取两份记录的并集。恢复后可手动取消不需要的点亮。

**照片较多时，推荐完整目录备份：** 先停止应用，再复制或压缩整个 `data` 目录。恢复时停止应用并放回该目录。单文件导出会在预计超过100MB时停止并提示使用完整目录备份，避免导出无法恢复的大文件。导入JSON上限300MB。

移除照片或实物记录会移除其当前引用；旧照片文件暂保留在 `uploads/`，以便通过前一版本档案恢复。完整目录备份包含这些文件，网页导出仅包含当前被引用的照片。

## 可选：同一Wi-Fi下用手机访问

默认仅本机可以访问。若想用手机连接同一台电脑：

macOS / Linux：

```bash
HOST=0.0.0.0 APP_PASSWORD='自己设置的密码' npm start
```

Windows PowerShell：

```powershell
$env:HOST="0.0.0.0"
$env:APP_PASSWORD="自己设置的密码"
npm start
```

然后在手机打开 `http://电脑的局域网IP:3000`。登录用户名可任意填写，密码为所设密码。手机和电脑访问的是同一份收藏记录，电脑必须保持运行。HTTP方式适合受信任的家庭局域网；若从互联网访问，应在HTTPS反向代理和访问控制后面运行。

可用环境变量：

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `PORT` | `3000` | 应用端口 |
| `HOST` | `127.0.0.1` | 监听地址 |
| `DATA_DIR` | 项目下的 `data` | 收藏数据位置，可放在代码目录外 |
| `APP_PASSWORD` | 未设置 | 可选访问密码 |

这些变量通过系统环境传入；应用不会自动读取 `.env` 文件。不要将密码写入源码。

## 可选：Docker

安装Docker后：

```bash
docker compose up --build -d
```

打开 http://localhost:3000。收藏保存在项目的 `data` 文件夹。容器停止／更新后保留。默认Docker端口只绑定本机；若要对局域网开放，需要自行调整compose端口绑定并设置密码。

## 图鉴范围与素材

用户确认以103款作为第一版收藏清单。同一动作的颜色、年代、底款和单纯尺寸差异合并；不同动作、场景或组合分别计数。同款买多件，进度仍只增加一种。

数据来自 [Beatrix Potter Figurines 的 Beswick 目录](https://beatrix-potter-figurines.co.uk/beswick-beatrix-potter-figurines/)，整理于2026-09-18。`public/catalog.json`逐条保留来源、原图链接、图片状态和待核备注；`docs/count-audit.json`记录目录拆分数量。103是固定的第一版工作清单，不代表完全核实的Beswick生产总目录。

三款原站没有对应图片，应用显示“参考图待补”，收藏后可使用自己的照片：

- Duchess with Pie
- Flopsy, Mopsy and Cottontail — Around a Pot
- Hunca Munca Cleaning a Saucepan

原始参考图片版权归相应权利人，未确认开放再使用许可。本仓库不授予第三方图片的转载授权。参考素材保留原图和出处；公开再发布请取得许可或改用自己的实物照片。

界面字体可在线加载Google Fonts，离线时自动使用系统字体。100张图鉴图片都在仓库内，不依赖原网站实时加载。

## 项目结构

```text
src/             React 界面与样式
public/          103款清单、100张参考图、favicon
server/          本地API、照片保存、原子写入、备份恢复
tests/           持久化、照片、备份、并发冲突与目录完整性验证
docs/            款式计数依据
```

技术栈：React + Vite，Express本地服务，JSON档案与照片文件；不需要单独安装数据库。写入使用队列、原子替换和目录锁；跨页面修改冲突会提示重新载入，避免静默覆盖。

本项目需要运行Node.js服务，不能仅将 `dist/` 放到GitHub Pages。GitHub用于保存源码；本地部署请按上面的启动方式运行。
