# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).


def migrate(cr, version):
    """The Barcode Inventory User group is dropped: it only granted the
    Inventory Administrator rights. Its members keep those rights directly."""
    cr.execute(
        """
        INSERT INTO res_groups_users_rel (gid, uid)
        SELECT manager.res_id, rel.uid
          FROM res_groups_users_rel rel
          JOIN ir_model_data barcode
            ON barcode.model = 'res.groups'
           AND barcode.module = 'barcode_inventory'
           AND barcode.name = 'group_barcode_inventory_user'
           AND barcode.res_id = rel.gid
          JOIN ir_model_data manager
            ON manager.model = 'res.groups'
           AND manager.module = 'stock'
           AND manager.name = 'group_stock_manager'
        ON CONFLICT DO NOTHING
        """
    )
