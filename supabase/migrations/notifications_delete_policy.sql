-- Let users delete (dismiss) their own notifications from the
-- /notifications.html page. The original setup_v2.sql only granted
-- SELECT / UPDATE / INSERT — DELETE was missing, so a dismiss button
-- in the UI would just fail under RLS.

drop policy if exists "Users delete own notifications" on public.notifications;
create policy "Users delete own notifications"
  on public.notifications for delete
  to authenticated
  using (user_id = auth.uid());
