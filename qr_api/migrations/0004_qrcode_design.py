from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("qr_api", "0003_qrcode_redirect_and_image"),
    ]

    operations = [
        migrations.AddField(
            model_name="qrcode",
            name="design",
            field=models.CharField(
                choices=[
                    ("classic", "Classic (black & white)"),
                    ("dotted_maroon", "Dotted (maroon)"),
                    ("dotted_teal", "Dotted (teal)"),
                ],
                db_index=True,
                default="classic",
                max_length=32,
            ),
        ),
    ]
