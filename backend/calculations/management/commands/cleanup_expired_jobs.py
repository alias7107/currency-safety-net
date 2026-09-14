from django.core.management.base import BaseCommand, CommandError

from calculations.retention import cleanup_expired_jobs, retention_cutoff


class Command(BaseCommand):
    help = (
        "Delete terminal optimization and buffer-sensitivity jobs older than "
        "JOB_RETENTION_DAYS (default 7). Never deletes queued or running jobs."
    )

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report counts without deleting rows.",
        )

    def handle(self, *args, **options) -> None:
        dry_run = bool(options["dry_run"])
        try:
            cutoff = retention_cutoff()
        except Exception as exc:
            raise CommandError(str(exc)) from exc

        result = cleanup_expired_jobs(cutoff=cutoff, dry_run=dry_run)
        mode = "dry-run" if dry_run else "deleted"
        self.stdout.write(
            f"retention_cleanup mode={mode} cutoff={cutoff.isoformat()} "
            f"optimization={result.optimization_count} "
            f"buffer_sensitivity={result.buffer_sensitivity_count} "
            f"total={result.total}"
        )
