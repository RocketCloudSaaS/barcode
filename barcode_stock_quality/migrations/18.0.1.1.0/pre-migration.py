# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).


def migrate(cr, version):
    """The Barcode Stock Quality User group is dropped: it only granted the
    Quality Control User rights. Its members keep those rights directly."""
    cr.execute(
        """
        INSERT INTO res_groups_users_rel (gid, uid)
        SELECT quality.res_id, rel.uid
          FROM res_groups_users_rel rel
          JOIN ir_model_data barcode
            ON barcode.model = 'res.groups'
           AND barcode.module = 'barcode_stock_quality'
           AND barcode.name = 'group_barcode_stock_quality_user'
           AND barcode.res_id = rel.gid
          JOIN ir_model_data quality
            ON quality.model = 'res.groups'
           AND quality.module = 'quality_control_oca'
           AND quality.name = 'group_quality_control_user'
        ON CONFLICT DO NOTHING
        """
    )
