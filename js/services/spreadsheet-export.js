/* Shared browser-side XLSX export helper. Requires xlsx-js-style to be loaded first. */
(function(){
  'use strict';
  window.SBL=window.SBL||{};

  const HEADER_STYLE={
    font:{bold:true,color:{rgb:'FFFFFF'},sz:11},
    fill:{patternType:'solid',fgColor:{rgb:'243B53'}},
    alignment:{vertical:'center',horizontal:'left',wrapText:true},
    border:{bottom:{style:'thin',color:{rgb:'9FB3C8'}}}
  };

  function requireXLSX(){
    const x=window.XLSX;
    if(!x?.utils?.aoa_to_sheet||!x?.utils?.book_new||typeof x.writeFile!=='function'){
      throw new Error('The spreadsheet exporter has not loaded. Check your connection, refresh the page, and try again.');
    }
    return x;
  }
  function setCellStyle(ws,row,col,style,x){
    const address=x.utils.encode_cell({r:row,c:col});
    if(!ws[address])ws[address]={t:'s',v:''};
    ws[address].s=style;
  }
  function downloadWorkbook(filename,sheets,options={}){
    const x=requireXLSX();
    if(!Array.isArray(sheets)||!sheets.length)throw new Error('There is no spreadsheet data to export.');
    const wb=x.utils.book_new();
    for(const definition of sheets){
      const safeName=String(definition.name||'Sheet').replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'Sheet';
      const rows=Array.isArray(definition.rows)?definition.rows:[];
      const ws=x.utils.aoa_to_sheet(rows);
      const widths=Array.isArray(definition.widths)?definition.widths:[];
      if(widths.length)ws['!cols']=widths.map(width=>({wch:Number(width)||14}));
      const headerRows=Math.max(0,Number(definition.headerRows??1)||0);
      if(rows.length&&rows[0].length){
        for(let r=0;r<headerRows;r++)for(let c=0;c<(rows[r]||[]).length;c++)setCellStyle(ws,r,c,definition.headerStyle||HEADER_STYLE,x);
        for(const [rowText,style] of Object.entries(definition.rowStyles||{})){
          const row=Number(rowText);if(!Number.isInteger(row)||row<0||row>=rows.length)continue;
          for(let c=0;c<(rows[row]||[]).length;c++)setCellStyle(ws,row,c,style,x);
        }
        for(const item of (definition.cellStyles||[])){
          if(Number.isInteger(item?.row)&&Number.isInteger(item?.col)&&item.row>=0&&item.col>=0&&item.row<rows.length&&item.col<(rows[item.row]||[]).length)setCellStyle(ws,item.row,item.col,item.style,x);
        }
        if(definition.autoFilter!==false){const range=x.utils.decode_range(ws['!ref']);ws['!autofilter']={ref:x.utils.encode_range({s:{r:0,c:0},e:{r:range.e.r,c:range.e.c}})};}
        if(definition.freezeHeader!==false&&headerRows)ws['!freeze']={xSplit:0,ySplit:headerRows,topLeftCell:`A${headerRows+1}`,activePane:'bottomLeft',state:'frozen'};
        if(definition.rowHeights)ws['!rows']=definition.rowHeights.map(h=>({hpt:Number(h)||20}));
      }
      x.utils.book_append_sheet(wb,ws,safeName);
    }
    const clean=String(filename||'Battle-Tower-Export.xlsx').replace(/[\\/:*?"<>|]+/g,'-');
    x.writeFile(wb,clean.toLowerCase().endsWith('.xlsx')?clean:`${clean}.xlsx`,{bookType:'xlsx',compression:true});
    return {ok:true,filename:clean};
  }

  window.SBL.spreadsheetExport=Object.freeze({downloadWorkbook,headerStyle:HEADER_STYLE});
})();
