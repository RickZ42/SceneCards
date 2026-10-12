export function drawMemoryScene(svg, current, t, width, marker) {
  let w=Math.max(288,Math.round(width)), X=f=>24+(w-48)*f;
  const ns='http://www.w3.org/2000/svg';
  function node(tag,attrs={},parent=svg){const n=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.appendChild(n);return n;}
  function text(value,x,y,maxWidth=w-32,small=false){
    const n=node('text',{x,y,'text-anchor':'middle',class:small?'small':''});n.textContent=value;
    if(n.getComputedTextLength()>maxWidth && value.includes(' ')){
      n.textContent='';let line=node('tspan',{x,y},n),s='';
      for(const word of value.split(' ')){const trial=s?`${s} ${word}`:word;line.textContent=trial;
        if(s && line.getComputedTextLength()>maxWidth){line.textContent=s+' ';line=node('tspan',{x,dy:18},n);s=word;line.textContent=word;}else s=trial;}
    }return n;
  }
  const lerp=(a,b,t)=>a+(b-a)*t;
  const clip=t=>Math.max(0,Math.min(1,t));
  const ease=t=>t*t*(3-2*t);
  function circle(x,y,r=12,kind='main'){return node('circle',{cx:x,cy:y,r,class:kind});}
  function rect(x,y,width,height,kind='main',extra={}){return node('rect',{x,y,width,height,rx:4,class:kind,...extra});}
  function line(x1,y1,x2,y2,kind='line',extra={}){return node('line',{x1,y1,x2,y2,class:kind,...extra});}
  function arrow(x1,y1,x2,y2){line(x1,y1,x2,y2,'line',{'marker-end':`url(#${marker})`});}
  function box(x,y,width,height,value,kind='main'){rect(x-width/2,y,width,height,kind);if(value)text(value,x,y+24,width-12,true);}
  function dotTravel(x1,y1,x2,y2,t,kind='main'){circle(lerp(x1,x2,t),lerp(y1,y2,t),6,kind);}
  function plant(x,y,size=1,bend=0){line(x,y,x+bend,y-75*size,'flow');node('ellipse',{cx:x+bend-13*size,cy:y-52*size,rx:17*size,ry:8*size,transform:`rotate(25 ${x+bend-13*size} ${y-52*size})`,class:'main'});node('ellipse',{cx:x+bend+13*size,cy:y-67*size,rx:17*size,ry:8*size,transform:`rotate(-25 ${x+bend+13*size} ${y-67*size})`,class:'main'});}
  function wave(y,t,strong=false){const amp=strong?5+25*t:3+18*t;const points=Array.from({length:45},(_,i)=>{const x=X(i/44);return`${i?'L':'M'}${x},${y+Math.sin(i*.65+t*9)*amp}`;}).join(' ');node('path',{d:points,class:'flow'});}
  svg.replaceChildren(); svg.setAttribute('viewBox',`0 0 ${w} 286`);
  const title=node('title'); title.textContent=`Memory scene: ${current.word || 'visual cue'}`;
  const desc=node('desc'); desc.textContent=current.steps.join(' ');
  const defs=node('defs'), m=node('marker',{id:marker,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto'},defs);
  node('path',{d:'M0 0 L10 5 L0 10 Z',fill:'var(--muted)'},m);
  const phase=Math.min(2,Math.floor(t*3));
  if (current.kind === 'timeline') {
    // Scene coordinates use a fixed canvas, adapted to the card width.
    const scale=(w-48)/688;
    for (const item of current.elements) {
      const frames=item.frames;
      const right=frames.findIndex(frame=>frame.at>=t);
      const hi=frames[right<0?frames.length-1:right], lo=frames[Math.max(0,(right<0?frames.length-1:right)-1)];
      const p=hi.at===lo.at?0:ease(clip((t-lo.at)/(hi.at-lo.at)));
      const v=Object.fromEntries(Object.keys(lo).filter(k=>k!=='at').map(k=>[k,lerp(lo[k],hi[k],p)]));
      const x=24+(v.x-24)*scale, y=v.y, kind=item.tone||'main';
      let shape;
      if(item.type==='circle') shape=circle(x,y,(v.r??8)*Math.min(1,scale),kind);
      if(item.type==='rect') shape=rect(x,y,(v.width??40)*scale,v.height??30,kind);
      if(item.type==='line') shape=line(x,y,24+((v.x2??v.x)-24)*scale,v.y2??y,kind);
      if(item.type==='text') shape=text(item.text,x,y,Math.min(w-32,Math.max(60,(v.width??180)*scale)),true);
      if(v.opacity!==undefined) shape.setAttribute('opacity',v.opacity);
      if(v.rotation) shape.setAttribute('transform',`rotate(${v.rotation} ${x} ${y})`);
    }
    text(current.steps[phase],X(.5),263,w-32,true);
    return;
  }
    const a=X(.18),b=X(.82),c=X(.5),bw=Math.min(150,(w-48)*.36),p=ease(t);
    switch(current.word){
      case 'perception':
        for(let i=0;i<9;i++)circle(X(.1+i*.1),110+(i%2)*22,i===6?5:8,i===6?'other':'neutral');
        circle(lerp(a,X(.7),p),lerp(145,110,p),25,'main').style.setProperty('fill','none');
        line(lerp(a,X(.7),p)+18,lerp(145,110,p)+18,lerp(a,X(.7),p)+35,lerp(145,110,p)+35);
        text('Look closely',c,52);text('A tiny difference',c,211,w-32,true);break;
      case 'rigorous':
        for(let i=0;i<3;i++){box(c,55+i*47,Math.min(w-64,320),36,`Check ${i+1}`,t>(i+1)*.25?'main':'neutral');}
        line(c-bw,lerp(60,194,p),c+bw,lerp(60,194,p),'flow');break;
      case 'asymmetry':
        line(c,45,c,209,'line',{'stroke-dasharray':'4 5'});
        rect(c-95,85,65,75,'main');rect(c+30,85,65,lerp(75,29,p),'other');
        text(t<.2?'Matching sides':'Unequal sides',c,218,w-32,true);break;
      case 'precedent':
        box(a,72,bw,75,'Earlier case');box(b,72,bw,75,'New case','neutral');
        arrow(a+bw/2,172,b-bw/2,172);dotTravel(a,172,b,172,p);
        text('Allowed',a,135,bw-12,true);if(t>.6)text('Same rule',b,135,bw-12,true);break;
      case 'xylem':
        rect(c-10,62,20,137,'main');for(let i=0;i<3;i++)line(c,198,c+(i-1)*35,223,'flow');
        node('ellipse',{cx:c-31,cy:60,rx:31,ry:13,transform:`rotate(25 ${c-31} 60)`,class:'main'});
        node('ellipse',{cx:c+31,cy:43,rx:31,ry:13,transform:`rotate(-25 ${c+31} 43)`,class:'main'});
        for(let i=0;i<4;i++)circle(c,lerp(199-i*18,70-i*7,p),4,'other');
        text('Roots',a,216,bw,true);text('Leaves',b,63,bw,true);text('Water moves up',c,28,w-32,true);break;
      case 'derived':
        plant(a,166,.8);box(b,82,bw,65,'Compound','other');arrow(a+28,176,b-25,176);dotTravel(a+25,176,b,176,p);
        text('Plant source',a,198,bw,true);text('Extract',c,62,w-32,true);break;
      case 'adequately':
        rect(c-38,65,76,148,'neutral');rect(c-35,211-lerp(28,96,p),70,lerp(28,96,p),'main');
        line(c-47,131,c+47,131,'line',{'stroke-dasharray':'4 4'});text('Needed level',c,42,w-32,true);
        text(t<.7?'Add enough':'Enough for the task',c,231,w-32,true);break;
      case 'canonical':
        box(a,70,bw,91,'Church rules');for(let i=0;i<3;i++)line(a-bw*.3,110+i*14,a+bw*.3,110+i*14);
        box(b,80,bw,70,'Request','neutral');dotTravel(b,179,a,179,p);arrow(b-12,179,a+12,179);
        text(t>.7?'Checked against the rules':'An established rulebook',c,218,w-32,true);break;
      case 'cluster':
        for(let i=0;i<10;i++){const angle=i*2.4;circle(lerp(X(.08+(i%5)*.21),c+Math.cos(angle)*35,p),lerp(60+Math.floor(i/5)*128,132+Math.sin(angle)*35,p),8);}
        text(t>.7?'Close together':'Scattered points',c,217,w-32,true);break;
      case 'cognition':
        box(a,92,bw,61,'3 + 2','neutral');circle(c,153,25);text('Think',c,158,45,true);box(b,92,bw,61,t>.65?'5':'?','other');
        dotTravel(a,187,b,187,p);text('Information → thinking → answer',c,46,w-32,true);break;
      case 'compatible':
        const fitX=lerp(b,c+35,p);rect(c-85,100,84,67,'main');rect(c-1,120,21,27,'main');
        node('path',{d:`M${fitX+46} 100 H${fitX-14} V120 H${fitX-34} V147 H${fitX-14} V167 H${fitX+46} Z`,class:'other'});
        text('Part A',a,77,bw,true);text('Part B',b,77,bw,true);text('Matching shapes',c,214,w-32,true);break;
      case 'confronting':
        box(c,48,Math.min(w-48,280),70,t<.3?'A comfortable idea':'A difficult truth',t<.3?'neutral':'other');
        for(let i=0;i<3;i++){circle(X(.24+i*.26),177,17,'neutral');text(t>.4?'?':'…',X(.24+i*.26),182,28);}
        line(c,125,c,lerp(127,153,p));text('Audience: rethink an assumption',c,224,w-32,true);break;
      case 'conservative':
        box(a,62,bw,113,'Traditional');box(b,62,bw,113,'New design','other');
        for(let i=0;i<3;i++){line(a-bw*.3,108+i*17,a+bw*.3,108+i*17);circle(b+(i-1)*16,122+i%2*22,5,'other');}
        circle(lerp(c,a,p),199,9);text('Choose the familiar style',c,232,w-32,true);break;
      case 'convention':
        text('A shared greeting custom',c,45,w-32,true);
        for(let i=0;i<3;i++){const x=X(.16+i*.34);circle(x,125,19,'neutral');box(x,166,Math.min(82,(w-48)*.29),42,i<2||t>.6?'Hello':'…');}
        dotTravel(a,83,b,83,p);break;
      case 'credible':
        box(c,55,Math.min(w-70,220),56,'Claim');
        for(let i=0;i<2;i++){const x=lerp(i?b:a,c+(i?42:-42),p);box(x,154,70,43,`Evidence ${i+1}`,'other');line(x,152,c,114);}
        text('Support gives a reason to believe',c,231,w-32,true);break;
      case 'exclusive':
        rect(c+5,57,Math.min(112,(w-48)*.4),138,'neutral');text('Guests only',c+Math.min(56,(w-48)*.2),84,Math.min(100,(w-48)*.4),true);
        circle(lerp(a,c+45,p),135,14);text('Guest',lerp(a,c+45,p),170,70,true);circle(a,199,12,'other');text('Other',a,224,65,true);
        line(c-4,180,c-4,217,'flow');break;
      case 'focal':
        for(let i=0;i<4;i++)circle(X(.1+i*.26),165,10,'neutral');circle(c,99,22);
        circle(lerp(a,c,p),lerp(150,99,p),lerp(18,37,p),'other').style.setProperty('fill','none');
        text('Main character',c,54,w-32,true);text('Supporting figures',c,214,w-32,true);break;
      case 'gross':
        box(c,37,Math.min(w-55,230),56,'Before tax: £1,000');
        box(a,145,bw,65,'Tax: £200','other');box(b,145,bw,65,'Take-home: £800');
        arrow(c-15,98,a,139);arrow(c+15,98,b,139);dotTravel(c-15,102,a,140,p,'other');dotTravel(c+15,102,b,140,p);break;
      case 'intervals':
        line(a,142,b,142);for(let i=0;i<4;i++){const x=lerp(a,b,i/3);line(x,128,x,156);circle(x,142,5,'neutral');}
        circle(lerp(a,b,p),114,9);text('Event → gap → event',c,53,w-32,true);
        text('Equal gaps in time',c,204,w-32,true);break;
      case 'junction':
        line(a,65,c,135,'flow');line(b,65,c,135,'flow');line(c,135,c,213,'flow');circle(c,135,11,'other');
        dotTravel(a,65,c,135,clip(t*2));dotTravel(b,65,c,135,clip(t*2));if(t>.5)dotTravel(c,135,c,213,clip((t-.5)*2));
        text('Road A',a,44,bw,true);text('Road B',b,44,bw,true);text('Roads meet here',c,241,w-32,true);break;
      case 'locus':
        box(c,102,Math.min(142,(w-48)*.5),78,'Committee room');
        for(let i=0;i<3;i++){const x=X(.1+i*.4);dotTravel(x,51,c,97,p);arrow(x,59,c,94);}
        text('Decisions made here',c,207,w-32,true);break;
      case 'patchy':
        rect(X(.08),61,X(.92)-X(.08),146,'neutral');
        for(let i=0;i<7;i++){const xx=X(.17+(i%4)*.2),yy=98+Math.floor(i/4)*61;if(t>i*.11)rect(xx-14,yy-16,29,33,'main');}
        rect(lerp(X(.13),X(.88),p)-11,58,22,144,'other');text('Covered areas + missed areas',c,231,w-32,true);break;
      case 'perspective':
        node('ellipse',{cx:c,cy:100,rx:29,ry:12,class:'main'});rect(c-29,100,58,76,'main');node('ellipse',{cx:c,cy:176,rx:29,ry:12,class:'main'});
        circle(a,156,20,'other');rect(b-17,134,34,46,'other');arrow(c-38,121,a+23,143);arrow(c+38,131,b-22,143);
        text('View A',a,207,bw,true);text('View B',b,207,bw,true);text('One object, different viewpoints',c,48,w-32,true);
        circle(lerp(a,b,p),228,4);break;
      case 'severe':
        wave(164,t,true);wave(197,t,true);rect(c-26,lerp(134,117,p),52,18,'other',{transform:`rotate(${Math.sin(t*9)*t*18} ${c} 136)`});
        text(t<.4?'Mild conditions':'A serious test of strength',c,65,w-32,true);break;
      case 'split':
        for(let i=0;i<8;i++){const dest=i<4?a:b,xx=dest+(i%2?9:-9),yy=108+Math.floor(i%4/2)*25;circle(lerp(c+(i%4)*13-20,xx,p),lerp(109+Math.floor(i/4)*25,yy,p),8,i<4?'main':'other');}
        text('Susan',a,195,bw,true);text('Kate',b,195,bw,true);text('One prize → two shares',c,46,w-32,true);break;
      case 'streaks':
        rect(X(.08),50,X(.92)-X(.08),153,'neutral');for(let i=0;i<5;i++){const x=X(.15+i*.16);line(x,78,x+Math.min(18,w*.04),78+113*p,'flow');}
        rect(lerp(X(.12),X(.86),p),61,15,128,'other');text('Long, narrow marks',c,228,w-32,true);break;
      case 'substitute':
        box(c,73,Math.min(136,(w-48)*.5),106,'Recipe','neutral');
        const butterX=lerp(c,a,ease(clip(t*2))),oilX=lerp(b,c,ease(clip((t-.4)/.6)));
        box(butterX,144,64,42,'Butter','other');box(oilX,144,53,42,'Oil');
        text('Butter OUT · oil IN',c,220,w-32,true);break;
      case 'tentative':
        box(c,65,Math.min(w-60,210),127,'Friday?','neutral');rect(c-44,113,88,56,'main',{'stroke-dasharray':'5 5'});
        circle(c+Math.sin(t*11)*27,139,7);text('Pencil it in; it may change',c,221,w-32,true);break;
      case 'turbulent':
        for(let row=0;row<3;row++)wave(95+row*43,t);for(let i=0;i<4;i++)circle(X(.15+i*.23)+Math.sin(t*15+i)*t*10,128+Math.cos(t*17+i)*t*30,6,'other');
        text('Rough, irregular movement',c,218,w-32,true);break;
      case 'vulnerable':
        plant(b,199,.8,t*16);line(b-40,204,b+40,204);for(let i=0;i<3;i++){const x=lerp(a,b-10,p);arrow(x-28,95+i*27,x,95+i*27);}
        text('Little protection from the wind',c,49,w-32,true);text('Easy to harm',c,231,w-32,true);break;
    }
    text(current.steps[phase],c,263,w-32,true);

}
