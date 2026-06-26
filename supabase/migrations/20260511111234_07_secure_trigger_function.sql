-- دالة handle_new_user تُستدعى فقط من trigger داخلي، ولا يجب أن تكون قابلة للاستدعاء عبر REST API
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM anon, authenticated;
;