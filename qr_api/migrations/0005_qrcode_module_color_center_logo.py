from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("qr_api", "0004_qrcode_design"),
    ]

    operations = [
        migrations.AddField(
            model_name="qrcode",
            name="module_color",
            field=models.CharField(
                default="#000000",
                help_text="Hex color (#RRGGBB) for QR modules only; center logo keeps its own colors.",
                max_length=7,
            ),
        ),
        migrations.AddField(
            model_name="qrcode",
            name="center_logo",
            field=models.ImageField(
                blank=True,
                help_text="PNG logo for Teal dots design (center overlay).",
                upload_to="qr_logos/%Y/%m/",
            ),
        ),
    ]
