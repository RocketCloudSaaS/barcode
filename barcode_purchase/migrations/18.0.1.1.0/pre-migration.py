# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).


def migrate(cr, version):
    """The Barcode Purchase User group is dropped: it only granted the
    Purchase user rights. Its members keep those rights directly."""
    cr.execute(
        """
        INSERT INTO res_groups_users_rel (gid, uid)
        SELECT purchase.res_id, rel.uid
          FROM res_groups_users_rel rel
          JOIN ir_model_data barcode
            ON barcode.model = 'res.groups'
           AND barcode.module = 'barcode_purchase'
           AND barcode.name = 'group_barcode_purchase_user'
           AND barcode.res_id = rel.gid
          JOIN ir_model_data purchase
            ON purchase.model = 'res.groups'
           AND purchase.module = 'purchase'
           AND purchase.name = 'group_purchase_user'
        ON CONFLICT DO NOTHING
        """
    )
