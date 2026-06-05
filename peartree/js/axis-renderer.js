import { TreeCalibration } from './phylograph.js';
import { overlapsZones }   from '@artic-network/pearcore/utils.js';
import { buildFont, TYPEFACES } from '@artic-network/pearcore/typefaces.js';
import { Axis } from './axis.js';

export class AxisRenderer {
  constructor(canvas, settings) {
    this._canvas  = canvas;
    this._ctx     = canvas.getContext('2d');
    this._visible = false;
    this._maxX       = 1;
    this._timed      = false;
    this._rootHeight = 0;
    this._fontSize   = 9;
    this._fontFamily    = 'monospace';
    this._typefaceKey   = null;
    this._typefaceStyle = null;
    this._calibration   = null;
    this._viewMinTipH   = 0;
    this._majorInterval    = 'auto';
    this._minorInterval    = 'off';
    this._majorLabelFormat = 'auto';
    this._minorLabelFormat = 'off';
    this._dateFormat       = 'yyyy-MM-dd';
    this._lastHash = '';
    this._direction = 'forward';
    this._rangeLeft  = null;
    this._rangeRight = null;
    this._axisColor          = null;
    this._axisLineWidth      = 1;
    this._axisFontSizeManual = false;
    this._heightFormatter    = null;
    this._spacingTop         = 3;
    this._axis = new Axis({ orientation: 'x', type: 'continuous' });
    this.setSettings(settings, false);
  }
  _syncAxisCoreState() {
    this._axis.setType(this._dateMode ? 'time' : 'continuous');
    this._axis.setGeometry({ maxValue: this._maxX, timed: this._timed, rootValue: this._rootHeight, viewMinValue: this._viewMinTipH });
    this._axis.setCalibration(this._calibration);
    this._axis.setDirection(this._direction);
    this._axis.setRange(this._rangeLeft, this._rangeRight);
    this._axis.setTransform({ scale: this._scaleX, offset: this._offsetX, spacingLeft: this._spacingLeft });
    this._axis.setTickOptions({ majorInterval: this._majorInterval, minorInterval: this._minorInterval });
  }
  setSettings(s, redraw=false) {
    if (s.axisColor!=null) this.setColor(s.axisColor);
    if (s.fontSize!=null) this.setFontSize(s.fontSize);
    if (s.lineWidth!=null) this.setLineWidth(s.lineWidth);
    if (s.spacingTop!=null) { this._spacingTop=s.spacingTop; this._lastHash=''; }
    if (redraw) this._lastHash='';
  }
  setHeightFormatter(fmt) { this._heightFormatter=fmt||null; this._lastHash=''; }
  setTreeParams({ maxX, isTimedTree, rootHeight }) { this._maxX=maxX; this._timed=isTimedTree; this._rootHeight=isTimedTree?(rootHeight||0):0; this._calibration=null; this._viewMinTipH=0; this._lastHash=''; }
  setCalibration(cal) { this._calibration=cal?.isActive?cal:null; this._viewMinTipH=cal?.minTipH??0; this._lastHash=''; }
  get _dateMode() { return this._calibration?.isActive??false; }
  setSubtreeParams({ maxX, rootHeight, minTipH }) { this._maxX=maxX; this._rootHeight=rootHeight; if(this._calibration?.isActive&&minTipH!=null)this._viewMinTipH=minTipH; this._lastHash=''; }
  setTickOptions({ majorInterval, minorInterval, majorLabelFormat, minorLabelFormat }) { this._majorInterval=majorInterval||'auto'; this._minorInterval=minorInterval||'off'; this._majorLabelFormat=majorLabelFormat||'auto'; this._minorLabelFormat=minorLabelFormat||'off'; this._lastHash=''; }
  setDateFormat(fmt) { this._dateFormat=fmt||'yyyy-MM-dd'; this._lastHash=''; }
  update(scaleX, offsetX, spacingLeft, labelRightPad, bgColor, fontSize, dpr=1) {
    if(!this._visible)return;
    const W=(this._canvas.parentElement?.clientWidth??this._canvas.clientWidth)||0;
    if(W===0)return;
    if(!this._axisFontSizeManual)this._fontSize=Math.max(7,fontSize-1);
    const reqH=Math.ceil(this._spacingTop+this._fontSize+15);
    if(this._canvas.style.height!==reqH+'px')this._canvas.style.height=reqH+'px';
    const H=reqH;if(H===0)return;
    const wPx=Math.round(W*dpr),hPx=Math.round(H*dpr);
    if(this._canvas.width!==wPx||this._canvas.height!==hPx){this._canvas.width=wPx;this._canvas.height=hPx;this._canvas.style.width=W+'px';this._ctx.setTransform(dpr,0,0,dpr,0,0);}
    const hash=`${scaleX.toFixed(4)}|${offsetX.toFixed(2)}|${spacingLeft}|${labelRightPad}|${bgColor}|${this._fontSize}|${this._fontFamily}|${this._typefaceKey??''}|${this._typefaceStyle??''}|${this._axisColor??''}|${this._axisLineWidth}|${W}|${H}|${this._timed}|${this._dateMode}|${this._rootHeight}|${this._calibration?.anchorDecYear??''}|${this._calibration?.anchorH??''}|${this._calibration?.rate??''}|${this._viewMinTipH}|${this._majorInterval}|${this._minorInterval}|${this._majorLabelFormat}|${this._minorLabelFormat}|${this._dateFormat}|${this._direction}|${this._rangeLeft??''}|${this._rangeRight??''}`;
    if(hash===this._lastHash)return;
    this._lastHash=hash;
    this._scaleX=scaleX;this._offsetX=offsetX;this._spacingLeft=spacingLeft;this._labelRightPad=labelRightPad;this._bgColor=bgColor;this._W=W;this._H=H;
    this._draw();
  }
  setVisible(v) { this._visible=!!v; this._lastHash=''; if(!v){this._ctx.clearRect(0,0,this._canvas.width,this._canvas.height);} }
  setFontSize(px) { this._fontSize=Math.max(6,px); this._axisFontSizeManual=true; this._lastHash=''; }
  setFontFamily(f) { this._fontFamily=f||'monospace'; this._typefaceKey=null; this._typefaceStyle=null; this._lastHash=''; }
  setTypeface(key,style) { this._typefaceKey=key||null; this._typefaceStyle=style||null; this._fontFamily=TYPEFACES[key]?.family??key??'monospace'; this._lastHash=''; }
  _font(sizePx) { if(this._typefaceKey)return buildFont(this._typefaceKey,this._typefaceStyle,sizePx); return `${sizePx}px ${this._fontFamily}`; }
  setColor(hex) { this._axisColor=hex||null; this._lastHash=''; }
  setLineWidth(w) { this._axisLineWidth=Math.max(0.5,w); this._lastHash=''; }
  setDirection(dir) { this._direction=(dir==='reverse')?'reverse':'forward'; this._lastHash=''; }
  setRange(leftVal,rightVal) { this._rangeLeft=(leftVal!=null&&isFinite(leftVal))?leftVal:null; this._rangeRight=(rightVal!=null&&isFinite(rightVal))?rightVal:null; this._lastHash=''; }
  getWorldExtent() { if(this._maxX==null)return null; this._syncAxisCoreState(); return this._axis.getWorldExtent(); }
  getScaleFactor(treeWorldLeft,treeWorldRight) { this._syncAxisCoreState(); return this._axis.getScaleFactorForTreeRange(treeWorldLeft,treeWorldRight); }
  _draw() {
    const ctx=this._ctx,W=this._W,H=this._H,fs=this._fontSize;
    ctx.clearRect(0,0,W,H);ctx.fillStyle=this._bgColor;ctx.fillRect(0,0,W,H);
    if(!this._scaleX||this._maxX===0)return;
    this._syncAxisCoreState();
    const{leftVal,rightVal}=this._axis.getValueDomain();
    const rangeScreenLeft=this._valToScreenX(leftVal),rangeScreenRight=this._valToScreenX(rightVal);
    const plotLeft=rangeScreenLeft,plotRight=rangeScreenRight;
    if(plotRight<=plotLeft)return;
    const targetMajor=Math.max(2,Math.round((plotRight-plotLeft)/90));
    const{majorTicks,minorTicks}=this._axis.getTicks(targetMajor);
    const Y_BASE=this._spacingTop??3,MAJOR_H=9,MINOR_H=5;
    const axC=this._axisColor;
    const TICK_COLOR=axC?AxisRenderer._hexToRgba(axC,0.55):'rgba(255,255,255,0.45)';
    const MINOR_COLOR=axC?AxisRenderer._hexToRgba(axC,0.30):'rgba(255,255,255,0.25)';
    const TEXT_COLOR=axC?AxisRenderer._hexToRgba(axC,1.0):'rgba(242,241,230,1.0)';
    const TEXT_DIM=axC?AxisRenderer._hexToRgba(axC,0.50):'rgba(242,241,230,0.45)';
    const lw=this._axisLineWidth;
    ctx.strokeStyle=TICK_COLOR;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(plotLeft,Y_BASE+0.5);ctx.lineTo(plotRight,Y_BASE+0.5);ctx.stroke();
    const majorLabelFmt=this._dateMode?this._majorLabelFormat:'auto';
    const showMajorLabel=majorLabelFmt!=='off';
    const _majorStep=majorTicks.length>=2?Math.abs(majorTicks[1]-majorTicks[0]):0;
    const effMajorInterval=(this._dateMode&&this._majorInterval==='auto')?TreeCalibration.inferMajorInterval(majorTicks):this._majorInterval;
    const minorLabelFmt=this._dateMode?this._minorLabelFormat:'off';
    const showMinorLabel=minorLabelFmt!=='off';
    let minorLabelRight=-Infinity;
    const effMinorInterval=(this._dateMode&&this._minorInterval==='auto')?TreeCalibration.inferMajorInterval(minorTicks):this._minorInterval;
    const majorLabelZones=[];
    if(showMinorLabel&&showMajorLabel){ctx.font=this._font(fs);for(const val of majorTicks){const sx=this._valToScreenX(val);if(sx<plotLeft-1||sx>plotRight+1)continue;const label=this._dateMode?this._calibration?.decYearToString(val,majorLabelFmt==='auto'?'partial':majorLabelFmt,this._dateFormat,effMajorInterval):Axis.formatValue(val,_majorStep);if(!label)continue;const tw=ctx.measureText(label).width;const lx=Math.max(plotLeft+tw/2+1,Math.min(W-tw/2-2,sx));majorLabelZones.push([lx-tw/2-4,lx+tw/2+4]);}}
    ctx.font=this._font(Math.max(6,fs-2));ctx.textAlign='center';ctx.textBaseline='top';
    for(const val of minorTicks){const sx=this._valToScreenX(val);if(sx<plotLeft-1||sx>plotRight+1)continue;ctx.strokeStyle=MINOR_COLOR;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(sx+0.5,Y_BASE+1);ctx.lineTo(sx+0.5,Y_BASE+1+MINOR_H);ctx.stroke();if(showMinorLabel){const label=this._calibration.decYearToString(val,minorLabelFmt,this._dateFormat,effMinorInterval);const tw=ctx.measureText(label).width;const lx=Math.max(plotLeft+tw/2+1,Math.min(plotRight-tw/2-1,sx));if(lx-tw/2>minorLabelRight+2&&!overlapsZones(lx-tw/2,lx+tw/2,majorLabelZones)){ctx.fillStyle=TEXT_DIM;ctx.fillText(label,lx,Y_BASE+1+MINOR_H+2);minorLabelRight=lx+tw/2;}}}
    let majorLabelRight=-Infinity;
    ctx.font=this._font(fs);ctx.textAlign='center';ctx.textBaseline='top';
    for(const val of majorTicks){const sx=this._valToScreenX(val);if(sx<plotLeft-1||sx>plotRight+1)continue;ctx.strokeStyle=TICK_COLOR;ctx.lineWidth=lw;ctx.beginPath();ctx.moveTo(sx+0.5,Y_BASE+1);ctx.lineTo(sx+0.5,Y_BASE+1+MAJOR_H);ctx.stroke();if(showMajorLabel){let label;if(this._dateMode){const effMajorFmt=(majorLabelFmt==='auto')?'partial':majorLabelFmt;label=this._calibration.decYearToString(val,effMajorFmt,this._dateFormat,effMajorInterval);}else{label=Axis.formatValue(val,_majorStep);}const tw=ctx.measureText(label).width;const lx=Math.max(plotLeft+tw/2+1,Math.min(W-tw/2-2,sx));if(lx-tw/2>majorLabelRight+2){ctx.fillStyle=TEXT_COLOR;ctx.fillText(label,lx,Y_BASE+1+MAJOR_H+2);majorLabelRight=lx+tw/2;}}}
  }
  _valueDomain() { this._syncAxisCoreState(); return this._axis.getValueDomain(); }
  _valToWorldX(val) { this._syncAxisCoreState(); return this._axis.valueToWorldX(val); }
  _valToScreenX(val) { this._syncAxisCoreState(); return this._axis.valueToCanvas(val); }
  static _hexToRgba(hex,alpha) { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgba(${r},${g},${b},${alpha})`; }
}
