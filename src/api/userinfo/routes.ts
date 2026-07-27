import { Router } from "express";
import { getUserinfo } from "./userinfo.handler.js";

/** Route table (data only) — handler logic lives in userinfo.handler.ts. */
export const userinfoRoutes: Router = Router();
userinfoRoutes.get("/userinfo", getUserinfo);
