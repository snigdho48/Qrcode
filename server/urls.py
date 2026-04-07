from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from qr_api.views import scan_landing

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("qr_api.urls")),
    path("s/<str:short_code>/", scan_landing, name="scan_landing"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
