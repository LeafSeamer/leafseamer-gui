import type {BrowserDraftClient} from '@leafseamer/sdk';
import type {Session} from './session.ts';
// 这里只保存SDK内存令牌的使用提示，不保存秘密，也不代替服务端当前授权。
export function createDirectedToken({ready,session,accept}:{ready:()=>BrowserDraftClient;session:()=>Session|null;accept:(status:string,expected:string)=>void}){
 let owner:Session|null=null,permissions:readonly string[]=[],expires=0;
 const reset=()=>{owner=null;permissions=[];expires=0;};
 return {reset,async ensure(scopes:string[],alive:()=>void){
  alive();const current=session();if(current&&owner===current&&performance.now()<expires&&scopes.every(s=>permissions.includes(s)))return;
  reset();const started=performance.now(),result=await ready().issueToken(scopes);alive();accept(result.status,'201');
  if(result.status==='201'&&current&&session()===current&&Number.isSafeInteger(result.body?.data.expires_in)&&result.body.data.expires_in>0){owner=current;permissions=[...scopes];expires=started+result.body.data.expires_in*1000;}
 }};
}
