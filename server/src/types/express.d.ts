declare module "express-serve-static-core" {
  interface Request {
    /** 当前角色，由 attachRole 中间件注入（AC-03） */
    role: import("@qingting/shared").Role;
  }
}

export {};
