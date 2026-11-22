/* CP4.154: Supabase password recovery landing page.
 * A recovery token is validated by Supabase Auth; the UI never handles
 * password-reset tokens or user passwords outside the authenticated session.
 */
(function(){
  'use strict';
  const auth = window.SBL.getSupabase().auth;
  const $ = id => document.getElementById(id);
  const requestForm=$('requestForm');
  const recoveryForm=$('recoveryForm');
  const message=$('recoveryMessage');
  const intro=$('recoveryIntro');
  const params=new URLSearchParams(location.search);
  const hash=new URLSearchParams(location.hash.slice(1));
  let recoveryAuthorized=false;
  let recoveryEventSeen=false;
  let finished=false;
  const hasRecoveryIndicators=(params.get('type')==='recovery'||hash.get('type')==='recovery'||params.has('code')||hash.has('access_token')||hash.has('error'));

  function setMessage(text,kind=''){
    message.textContent=String(text||'');
    message.className=kind;
  }
  function showRequest(){
    if(finished||recoveryAuthorized)return;
    intro.textContent='Enter the email associated with your account to receive a secure reset link.';
    requestForm.hidden=false;
    recoveryForm.hidden=true;
  }
  function showRecovery(){
    if(finished)return;
    recoveryAuthorized=true;
    requestForm.hidden=true;
    recoveryForm.hidden=false;
    intro.textContent='Your recovery link is verified. Set a new password below.';
    setMessage('');
  }
  function showInvalid(reason){
    recoveryAuthorized=false;
    recoveryForm.hidden=true;
    requestForm.hidden=false;
    intro.textContent='This link is invalid or expired. Request a new password reset email.';
    setMessage(reason||'Please request a new link.','error');
  }

  // This event is authoritative for password recovery. A normal signed-in
  // session is NOT enough to display the change-password form.
  const {data:subscription}=auth.onAuthStateChange((event)=>{
    if(event==='PASSWORD_RECOVERY'){
      recoveryEventSeen=true;
      showRecovery();
    }
  });

  requestForm.addEventListener('submit',async event=>{
    event.preventDefault();
    const email=$('recoveryEmail').value.trim();
    if(!email)return;
    const button=$('requestResetBtn');button.disabled=true;
    setMessage('Requesting a recovery email…');
    try{
      const redirectTo=new URL('reset-password.html',location.href).href;
      const {error}=await auth.resetPasswordForEmail(email,{redirectTo});
      if(error)throw error;
      setMessage('If an account exists for that email, a recovery link will arrive shortly. Check your spam folder.','success');
    }catch(error){setMessage(error?.message||'Unable to send email. Try again later.','error');}
    finally{button.disabled=false;}
  });

  recoveryForm.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!recoveryAuthorized){setMessage('Open a valid password recovery link first.','error');return;}
    const password=$('newPassword').value;
    if(password.length<8){setMessage('Use a password of at least 8 characters.','error');return;}
    if(password!==$('confirmPassword').value){setMessage('Passwords do not match.','error');return;}
    const button=$('updatePasswordBtn');button.disabled=true;
    setMessage('Updating your password…');
    try{
      const {error}=await auth.updateUser({password});
      if(error)throw error;
      finished=true;
      recoveryAuthorized=false;
      recoveryForm.hidden=true;
      $('newPassword').value='';$('confirmPassword').value='';
      intro.textContent='Your password has been updated successfully.';
      setMessage('You can now return to Battle Tower.','success');
      // Remove tokens from the location after successful recovery.
      history.replaceState(null,'',location.pathname);
      await auth.signOut({scope:'local'});
    }catch(error){setMessage(error?.message||'Unable to update the password.','error');button.disabled=false;}
  });

  const redirectError=hash.get('error_description')||params.get('error_description');
  if(redirectError){showInvalid(redirectError.replace(/\+/g,' '));}
  else if(!hasRecoveryIndicators){showRequest();}
  else {
    intro.textContent='Verifying your recovery link…';
    // Supabase may process the URL before the callback is attached. On a PKCE
    // code URL, an active session after the redirect code exchange is proof
    // of a just-completed recovery; generic existing sessions cannot qualify.
    auth.getSession().then(({data,error})=>{
      if(recoveryEventSeen||finished)return;
      if(error){showInvalid('Could not verify the recovery link.');return;}
      if(data?.session && (params.has('code')||hash.get('type')==='recovery'))showRecovery();
      else showInvalid('Could not verify the recovery link. Request a new one.');
    }).catch(()=>showInvalid('Could not verify the recovery link.'));
  }
})();
