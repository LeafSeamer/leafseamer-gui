import assert from 'node:assert/strict';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// 与命令检查共用真实 Controller 页面及网络记录，不替换服务响应。
export async function verifyControl({page,requests,output}) {
  const pane=page.getByRole('region',{name:'人员控制',exact:true});
  const writes=()=>requests.filter(r=>r.method==='POST'&&/\/control\/(acquire|release)$/.test(r.path));
  await page.getByLabel('操作原因',{exact:true}).fill('浏览器接管验证');
  await pane.getByRole('button',{name:'准备接管',exact:true}).click();
  await pane.locator('[data-control-phase="prepared"]').waitFor();assert.equal(writes().length,0);
  await pane.getByRole('button',{name:'取消准备',exact:true}).click();assert.equal(writes().length,0);
  const states=[];
  async function lookup(expectedMode) {
    for(let attempt=0;attempt<20;attempt++) {
      const response=page.waitForResponse(r=>/\/control-operations\//.test(new URL(r.url()).pathname)&&r.request().method()==='GET');
      await pane.getByRole('button',{name:'查询原操作',exact:true}).click();
      const result=await response;assert.equal(result.status(),200);const operation=await result.json();
      await pane.getByRole('button',{name:'查询原操作',exact:true}).waitFor({state:'visible'});
      if(operation.state==='effective') {
        await pane.locator('[data-control-state="effective"]').waitFor();
        await page.getByRole('definition').filter({hasText:/^保护中$/}).waitFor();
        await page.getByRole('definition').filter({hasText:new RegExp('^'+expectedMode+'$')}).waitFor();states.push(operation);return;
      }
      assert.equal(operation.state,'pending');await delay(100);
    }
    assert.fail('control_operation_not_effective');
  }
  for(const [button,mode] of [['准备接管','手动'],['准备释放','自动化']]) {
    await page.getByLabel('操作原因',{exact:true}).fill('浏览器控制验证');
    await pane.getByRole('button',{name:button,exact:true}).click();
    await pane.locator('[data-control-phase="prepared"]').waitFor();
    const count=writes().length,accepted=page.waitForResponse(r=>r.request().method()==='POST'&&/\/control\/(acquire|release)$/.test(new URL(r.url()).pathname));
    await pane.getByRole('button',{name:'确认提交',exact:true}).focus();await page.keyboard.press('Enter');
    const response=await accepted;assert.equal(response.status(),202,JSON.stringify(await response.json()));
    await pane.locator('[data-control-phase="accepted"]').waitFor();assert.equal(writes().length,count+1);
    assert.equal(await pane.locator('[data-control-state]').count(),0);
    await lookup(mode);
    if(mode==='手动') {
      await page.screenshot({path:path.join(output,'control-desktop.png'),fullPage:true});
      await page.reload();await page.getByRole('heading',{name:'登录工作台',exact:true}).waitFor();
      await page.getByLabel('用户名',{exact:true}).fill('role.test');await page.getByLabel('密码',{exact:true}).fill('Synthetic-role-password-123');
      await page.getByRole('button',{name:'登录',exact:true}).click();
      await pane.locator('[data-control-phase="unknown"]').waitFor();assert.equal(writes().length,count+1);
      const recovered=page.waitForResponse(r=>/\/control-requests\/lookup$/.test(new URL(r.url()).pathname));
      await lookup(mode);const found=await recovered;assert.equal(found.status(),200);
      assert.deepEqual(states.at(-1).identity,states.at(-2).identity);assert.equal(writes().length,count+1);
      await page.setViewportSize({width:390,height:844});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:path.join(output,'control-mobile.png'),fullPage:true});await page.setViewportSize({width:1440,height:900});
    }
    await pane.getByRole('button',{name:'关闭已确认记录',exact:true}).click();
  }
  assert.equal(writes().length,2);assert.equal(states.length,3);return 2;
}
