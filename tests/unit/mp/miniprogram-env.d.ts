// 客户端 lib 用例（如 share.test.ts）会把 wx 依赖模块带进根 tsc 程序；
// typings 只安装在 miniprogram/ 下（R11），这里用路径引用补上，不改根依赖。
/// <reference path="../../../miniprogram/node_modules/miniprogram-api-typings/types/index.d.ts" />
