import test from 'node:test';
import assert from 'node:assert/strict';
import {formatMoneyField,parseMoney} from '../../public/trading/money-format.js';

test('typing digits keeps each keystroke before execution rounding',()=>{
 const input={value:'',selectionStart:0,setCustomValidity(v){this.message=v;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}};
 globalThis.document={activeElement:input};
 for(const digit of '123456'){input.value+=digit;input.selectionStart=input.value.length;formatMoneyField(input);assert.equal(input.value.replaceAll(',',''),'123456'.slice(0,input.value.replaceAll(',','').length));}
 assert.equal(input.value,'123,456');assert.equal(parseMoney(input.value),123450);
 input.value='1';input.selectionStart=1;formatMoneyField(input);assert.equal(input.value,'1');
 input.value='';formatMoneyField(input);assert.equal(input.value,'');
 input.value='12x';formatMoneyField(input);assert.ok(input.message);assert.equal(input.value,'12x');
 delete globalThis.document;
});

test('middle insertion preserves all digits and caret',()=>{
 const input={value:'1293,456',selectionStart:3,setCustomValidity(){},setSelectionRange(a){this.selectionStart=a;}};
 globalThis.document={activeElement:input};formatMoneyField(input);assert.equal(input.value,'1,293,456');assert.equal(input.selectionStart,4);delete globalThis.document;
});

for (const mode of ['paper','live']) test(mode+' connection failure preserves settings access and restores controls',async()=>{
 globalThis.location={href:'http://localhost/?mode='+mode,origin:'http://localhost'};globalThis.window={};globalThis.parent=globalThis.window;
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,dataset:{},hasAttribute(){return Object.hasOwn(this.dataset,'connectionDisabled');}});return nodes.get(id);};
 const save={disabled:false};globalThis.document={getElementById:node,querySelector:()=>save};
 const {renderWorkspace}=await import('../../public/trading/workspace.js?test='+mode);
 const state={engine:{running:false},worker:{connectionLost:true}};
 renderWorkspace(state);assert.equal(node('settingsBtn').disabled,false);assert.equal(save.disabled,true);assert.equal(node('capitalBtn').disabled,true);
 // The main render recomputes these action-specific guards before workspace render.
 node('startBtn').disabled=true;node('analyzeBtn').disabled=false;node('submitOrder').disabled=true;
 renderWorkspace({...state,worker:{connectionLost:false}});
 assert.equal(node('capitalBtn').disabled,false);assert.equal(node('settingsBtn').disabled,false);assert.equal(save.disabled,false);assert.equal(node('startBtn').disabled,true);assert.equal(node('submitOrder').disabled,true);
 delete globalThis.document;delete globalThis.location;delete globalThis.window;delete globalThis.parent;
});
