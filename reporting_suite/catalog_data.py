"""Tenant-scoped projections for the local reporting administrator."""


def minimum_group(db):
    return int(db.execute(
        "SELECT value FROM dataset_metadata WHERE key='small_population_threshold'"
    ).fetchone()[0])


def catalog_snapshot(db, tenant, grants, fields, employee=None, *, can_view_order_value=False):
    def query(sql):
        return [dict(row) for row in db.execute(sql, {"tenant": tenant, "employee": employee})]

    result = {"grants": sorted(grants), "minimum_group": minimum_group(db)}
    if grants & {"R3", "B1"}:
        result["banks"] = query("SELECT bank_id,name FROM funding_banks WHERE tenant_id=:tenant ORDER BY name")
        result["funding"] = query("""
            SELECT b.bank_id,b.kind,b.points_delta,b.occurred_at,b.recognition_id,b.recipient_id,
              r.program_id,r.sender_id,b.reason FROM bank_ledger b
            LEFT JOIN recognitions r USING(tenant_id,recognition_id)
            WHERE b.tenant_id=:tenant ORDER BY b.occurred_at,b.transaction_id""")
        result["monetary"] = dict(db.execute("SELECT program_id,monetary FROM programs WHERE tenant_id=?", (tenant,)))
    if "B1" in grants:
        result["commitments"] = query("SELECT bank_id,program_id,potential_points FROM v_pending_commitments WHERE tenant_id=:tenant")
        result["bank_programs"] = query("SELECT bank_id,program_id FROM bank_programs WHERE tenant_id=:tenant")
    if "P1" in grants:
        result["wallet"] = query("""
            SELECT l.transaction_id,l.employee_id,l.kind,l.points_delta,l.occurred_at,l.recognition_id,
              l.order_id,l.reason,r.program_id FROM employee_points_ledger l
            LEFT JOIN recognitions r USING(tenant_id,recognition_id)
            WHERE l.tenant_id=:tenant AND (:employee IS NULL OR l.employee_id=:employee) ORDER BY l.occurred_at,l.transaction_id""")
    if grants & {"O1", "O2"}:
        order_value = ",value_minor" if can_view_order_value else ""
        unit_value = ",unit_value_minor" if can_view_order_value else ""
        orders = query(f"""SELECT order_id,employee_id,redemption_source,entitlement_id,submitted_at,
            status,points_spent{order_value},item_units,processing_at,first_shipped_at,delivered_at
            FROM v_order_activity WHERE tenant_id=:tenant AND (:employee IS NULL OR employee_id=:employee) ORDER BY submitted_at DESC,order_id""")
        def children(parents, key, name, sql):
            lookup = {r[key]: r for r in parents}
            for r in parents:
                r[name] = []
            for child in query(sql):
                parent = lookup.get(child[key])
                if parent is not None:
                    parent[name].append(child)
        children(orders,"order_id","items",f"""SELECT order_id,item_id,sku,description,quantity{unit_value}
            FROM order_items WHERE tenant_id=:tenant ORDER BY item_id""")
        children(orders,"order_id","history","""SELECT order_id,status,occurred_at,exception_code,detail
            FROM order_events WHERE tenant_id=:tenant ORDER BY occurred_at,order_event_id""")
        children(orders,"order_id","shipments","""SELECT s.order_id,s.carrier,s.tracking_reference,s.shipped_at,
            s.delivered_at,si.item_id,si.quantity FROM shipments s JOIN shipment_items si
            USING(tenant_id,order_id,shipment_id) WHERE s.tenant_id=:tenant ORDER BY s.shipped_at,si.item_id""")
        result["orders"] = orders
    if "I1" in grants:
        result["requests"] = query("""SELECT recognition_id,program_id,sender_id,status,submitted_at,
            approved_at,issued_at,notified_at,current_stage,responsible_approver_id FROM recognitions
            WHERE tenant_id=:tenant ORDER BY submitted_at DESC,recognition_id""")
        result["request_recipients"] = query("""SELECT recognition_id,employee_id,points FROM recognition_recipients
            WHERE tenant_id=:tenant""")
        reason = "reason" if "approval_reason" in fields else "NULL AS reason"
        result["steps"] = query(f"""SELECT recognition_id,stage,action,actor_id,occurred_at,{reason}
            FROM approval_events WHERE tenant_id=:tenant ORDER BY occurred_at,approval_event_id""")
    if "F1" in grants:
        result["allocations"] = query("""SELECT f.allocation_id,f.employee_id,f.allocated_points,f.funding_cost_minor,
            f.liability_released_minor,f.taxable_value_minor,f.source_calculation_id,f.tax_jurisdiction,
            a.recognition_id,r.program_id,d.order_id,d.occurred_at,f.award_transaction_id,f.redemption_transaction_id,
            a.occurred_at AS awarded_at,o.value_minor,o.fulfillment_cost_minor,o.points_spent
            FROM platform_financial_allocations f JOIN employee_points_ledger a ON
            a.tenant_id=f.tenant_id AND a.transaction_id=f.award_transaction_id
            JOIN employee_points_ledger d ON d.tenant_id=f.tenant_id AND d.transaction_id=f.redemption_transaction_id
            JOIN recognitions r ON r.tenant_id=f.tenant_id AND r.recognition_id=a.recognition_id
            JOIN orders o ON o.tenant_id=d.tenant_id AND o.order_id=d.order_id
            WHERE f.tenant_id=:tenant ORDER BY d.occurred_at,f.allocation_id""")
    return result
