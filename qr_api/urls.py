from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views

urlpatterns = [
    path("webhook/", views.whatsapp_webhook, name="whatsapp_webhook_api"),
    path("auth/register/", views.RegisterView.as_view(), name="register"),
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("codes/", views.QRCodeListCreateView.as_view(), name="codes"),
    path("codes/<uuid:pk>/", views.QRCodeDetailView.as_view(), name="code_detail"),
    path("codes/<uuid:pk>/scans/", views.QRCodeScansView.as_view(), name="code_scans"),
    path("analytics/summary/", views.AnalyticsSummaryView.as_view(), name="analytics_summary"),
    path("analytics/report/", views.AnalyticsReportView.as_view(), name="analytics_report"),
    path("analytics/meta/", views.AnalyticsMetaView.as_view(), name="analytics_meta"),
    path("analytics/qrcode-options/", views.QRCodeOptionsView.as_view(), name="analytics_qrcode_options"),
    path("whatsapp/manual-menu/", views.whatsapp_manual_menu, name="whatsapp_manual_menu"),
    path("track/<str:short_code>/", views.track_scan, name="track_scan"),
]
