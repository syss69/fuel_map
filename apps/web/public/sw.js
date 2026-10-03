self.addEventListener('push',event=>{
 let data;try{data=event.data?.json();}catch{return;}
 if(!data?.title)return;
 event.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.id,renotify:false,data:{stationId:data.stationId,fuelCode:data.fuelCode}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL('/app',self.location.origin);
 if(event.notification.data?.stationId)url.searchParams.set('station',event.notification.data.stationId);
 if(event.notification.data?.fuelCode)url.searchParams.set('fuel',event.notification.data.fuelCode);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  for(const window of windows){if(new URL(window.url).origin===url.origin){await window.navigate(url.href);return window.focus();}}
  return self.clients.openWindow(url.href);
 })());
});
