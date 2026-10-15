import { WhatsNewService } from '../src/service.js';
import { startServer } from '../src/server.js';
import { fileURLToPath } from 'node:url';

const rows = [
  ['freeCodeCamp/freeCodeCamp','freeCodeCamp','学习资源','跟随交互式课程和真实项目，系统学习编程与软件开发。',['编程入门','免费课程','社区学习'],'TypeScript',430000],
  ['sindresorhus/awesome','awesome','学习资源','按主题收集优质开源工具和学习资源的精选列表。',['资源合集','精选清单','开源导航'],null,410000],
  ['facebook/react','react','开发工具','用组件构建交互界面，让复杂应用保持清晰与高效。',['前端开发','用户界面','组件化'],'JavaScript',240000],
  ['ollama/ollama','ollama','人工智能','在本地运行开源大语言模型，快速搭建自己的 AI 工作流。',['大语言模型','本地部署','开发者工具'],'Go',160000],
  ['tensorflow/tensorflow','tensorflow','科研学术','从实验到部署，构建并训练机器学习模型的完整工具平台。',['机器学习','科学计算','模型训练'],'C++',192000],
  ['microsoft/vscode','vscode','开发工具','支持丰富扩展的代码编辑器，让日常开发更加顺手。',['代码编辑器','跨平台','扩展生态'],'TypeScript',174000],
  ['comfyanonymous/ComfyUI','ComfyUI','艺术设计','通过节点式工作流，自由组合图像生成与创意制作流程。',['图像生成','节点工作流','创意工具'],'Python',88000],
  ['obsproject/obs-studio','obs-studio','摄影影像','用专业的场景和音视频控制，实现高质量录屏与直播。',['视频录制','直播工具','音视频'],'C++',66000],
  ['excalidraw/excalidraw','excalidraw','艺术设计','在轻巧的协作白板上，用手绘风格记录和表达你的想法。',['协作白板','手绘风格','可视化'],'TypeScript',105000],
  ['pytorch/pytorch','pytorch','科研学术','用灵活的张量计算和自动微分，加速深度学习研究。',['深度学习','模型训练','科学计算'],'Python',90000],
  ['rustdesk/rustdesk','rustdesk','效率工具','通过开源远程桌面，随时连接并控制自己的设备。',['远程桌面','跨平台','自托管'],'Rust',90000],
  ['blender/blender','blender','艺术设计','将建模、动画与渲染融为一体，制作完整的三维作品。',['三维建模','动画制作','渲染'],'C++',16000]
];
const repos = rows.map(([id,name,category,summary,tags,language,stars],i)=>({id,name,owner:id.split('/')[0],url:`https://github.com/${id}`,category,summary,description:summary,tags,language,stars,rank:i+1,branch:'main',createdAt:'2025-01-01T00:00:00Z',topics:[],forks:Math.round(stars*.08),analyzed:true,analysisSource:'演示数据',contentSource:'人工编写的演示摘要',pushedAt:'2026-10-12T08:00:00Z',license:'MIT',analyzedAt:'2026-10-13T06:00:00Z'}));
const github = {
  async starHistory(repo, days){ const createdAt=repo.createdAt, count=days==='all' ? Math.floor((Date.parse(new Date().toISOString().slice(0,10))-Date.parse(createdAt))/86400000)+1 : days; return {points:Array.from({length:count},(_,i)=>({date:new Date(Date.parse(new Date().toISOString().slice(0,10))-(count-1-i)*86400000).toISOString().slice(0,10),stars:Math.round(80+30*Math.sin(i/5)+(rows.findIndex(r=>r[0]===repo.id)+1)*3+i%17)})),days,createdAt,metric:'daily-new-stars',source:'人工编写的演示历史（非真实数据）',fetchedAt:new Date().toISOString(),to:new Date().toISOString().slice(0,10),note:'仅用于离线展示图表；正式模式查询 GitHub 官方历史数据。'}; },
  async top(){ return repos.map(r=>({...r,analyzed:false})); },
  async readme(){ return {text:'演示数据',source:'演示数据'}; },
  async detail(r){ return { version:'release:demo-v2',versionLabel:'demo-v2',release:{name:'演示版本',body:'【演示数据】\n此处展示维护者发布的版本简介。\n\n• 改进日常操作体验\n• 修复已知问题\n\n正式模式展示 GitHub 返回的原始内容。',publishedAt:'2026-10-12T08:00:00Z',url:r.url+'/releases'},commits:[{sha:'a8f0421demo',message:'【演示】Improve documentation and usability',date:'2026-10-12T08:00:00Z',url:r.url}],releaseDownloads:125000,downloadScope:'演示下载统计',assets:[],checkedAt:new Date().toISOString()}; }
};
const service = new WhatsNewService({root:fileURLToPath(new URL('../',import.meta.url)),github,demo:true,analyze:async batch=>{await new Promise(r=>setTimeout(r,1200));return batch.map(r=>({...r,analyzed:true}));}});
await service.init(); service.state.repos = repos; service.state.analyzedAt = '2026-10-13T06:00:00Z';
service.state.inspiration = {id:'demo-idea',title:'开源创意实验室',summary:'【演示构想】把设计、影像和 AI 工具整理成可复用的创意任务清单，帮助创作者规划一个小作品。',problem:'【演示数据】需求假设：创作者在不同开源工具之间切换时，可能缺少清晰的任务组织方式；需要真实访谈验证。',audience:'尝试用开源工具制作作品的创作者',differentiation:'演示构想聚焦任务组织和工具关联，将一个创意拆为可以行动的小步骤。',features:['建立一份可编辑的创作步骤清单','为创作步骤关联可使用的开源工具','导出项目计划与工具来源链接'],evidence:[{id:'excalidraw/excalidraw',observation:'【演示观察】白板可用于整理想法。',quote:'演示引文，不是真实仓库引用。'}],validation:['访谈目标创作者确认工具切换的真实困难','邀请用户尝试整理一个完整作品的创作计划'],risks:['演示构想尚未验证需求和实现可行性'],generatedAt:new Date().toISOString()};
service.inspirationJob={status:'complete',message:'演示灵感'};

const runtime=await startServer(service,{port:Number(process.env.WHATSNEW_PORT || 3211)});
console.log(`WhatsNew 演示（非实时数据）：${runtime.url}`);
for(const sig of ['SIGINT','SIGTERM']) process.on(sig,async()=>{await runtime.close();process.exit(0);});
