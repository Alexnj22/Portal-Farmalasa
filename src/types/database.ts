export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      abonos_de_cliente: {
        Row: {
          abonado: number
          anotado_por: string
          anulado_motivo: string | null
          branch_id: number
          cliente_erp_id: number | null
          cliente_nombre: string
          cliente_telefono: string | null
          created_at: string
          estado: string
          fecha: string
          folio: string
          id: number
          movimiento_ingreso_id: number | null
          movimiento_vale_id: number | null
          renglones: Json
          retirado_at: string | null
          retirado_por: string | null
          total: number | null
          updated_at: string
          vence_el: string
        }
        Insert: {
          abonado: number
          anotado_por: string
          anulado_motivo?: string | null
          branch_id: number
          cliente_erp_id?: number | null
          cliente_nombre: string
          cliente_telefono?: string | null
          created_at?: string
          estado?: string
          fecha: string
          folio: string
          id?: never
          movimiento_ingreso_id?: number | null
          movimiento_vale_id?: number | null
          renglones?: Json
          retirado_at?: string | null
          retirado_por?: string | null
          total?: number | null
          updated_at?: string
          vence_el: string
        }
        Update: {
          abonado?: number
          anotado_por?: string
          anulado_motivo?: string | null
          branch_id?: number
          cliente_erp_id?: number | null
          cliente_nombre?: string
          cliente_telefono?: string | null
          created_at?: string
          estado?: string
          fecha?: string
          folio?: string
          id?: never
          movimiento_ingreso_id?: number | null
          movimiento_vale_id?: number | null
          renglones?: Json
          retirado_at?: string | null
          retirado_por?: string | null
          total?: number | null
          updated_at?: string
          vence_el?: string
        }
        Relationships: [
          {
            foreignKeyName: "abonos_de_cliente_anotado_por_fkey"
            columns: ["anotado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abonos_de_cliente_anotado_por_fkey"
            columns: ["anotado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abonos_de_cliente_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abonos_de_cliente_movimiento_ingreso_id_fkey"
            columns: ["movimiento_ingreso_id"]
            isOneToOne: false
            referencedRelation: "caja_movimientos_portal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abonos_de_cliente_movimiento_vale_id_fkey"
            columns: ["movimiento_vale_id"]
            isOneToOne: false
            referencedRelation: "caja_movimientos_portal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abonos_de_cliente_retirado_por_fkey"
            columns: ["retirado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abonos_de_cliente_retirado_por_fkey"
            columns: ["retirado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          created_at: string
          created_by: string | null
          edited_at: string | null
          id: string
          is_archived: boolean
          message: string
          metadata: Json | null
          prev_read_by: Json
          priority: string
          read_by: Json
          scheduled_for: string | null
          target_type: string
          target_value: Json | null
          title: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          edited_at?: string | null
          id?: string
          is_archived?: boolean
          message: string
          metadata?: Json | null
          prev_read_by?: Json
          priority?: string
          read_by?: Json
          scheduled_for?: string | null
          target_type: string
          target_value?: Json | null
          title: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          edited_at?: string | null
          id?: string
          is_archived?: boolean
          message?: string
          metadata?: Json | null
          prev_read_by?: Json
          priority?: string
          read_by?: Json
          scheduled_for?: string | null
          target_type?: string
          target_value?: Json | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          approvals: Json
          approver_id: string | null
          approver_note: string | null
          created_at: string | null
          current_level: number
          employee_id: string
          id: string
          metadata: Json | null
          note: string | null
          status: string
          type: string
          updated_at: string | null
        }
        Insert: {
          approvals?: Json
          approver_id?: string | null
          approver_note?: string | null
          created_at?: string | null
          current_level?: number
          employee_id: string
          id?: string
          metadata?: Json | null
          note?: string | null
          status?: string
          type: string
          updated_at?: string | null
        }
        Update: {
          approvals?: Json
          approver_id?: string | null
          approver_note?: string | null
          created_at?: string | null
          current_level?: number
          employee_id?: string
          id?: string
          metadata?: Json | null
          note?: string | null
          status?: string
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_approver_id_fkey"
            columns: ["approver_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance: {
        Row: {
          created_at: string
          details: Json | null
          employee_id: string
          id: number
          timestamp: string
          type: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          employee_id: string
          id?: number
          timestamp: string
          type: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          employee_id?: string
          id?: number
          timestamp?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          branch_id: number | null
          branch_name: string | null
          created_at: string
          details: Json | null
          device_name: string | null
          id: string
          input_method: string | null
          severity: string
          source: string
          target_id: string | null
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          action: string
          branch_id?: number | null
          branch_name?: string | null
          created_at?: string
          details?: Json | null
          device_name?: string | null
          id?: string
          input_method?: string | null
          severity?: string
          source?: string
          target_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          action?: string
          branch_id?: number | null
          branch_name?: string | null
          created_at?: string
          details?: Json | null
          device_name?: string | null
          id?: string
          input_method?: string | null
          severity?: string
          source?: string
          target_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_audit_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_audit_logs_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_audit_logs_user"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      avisos_diferidos: {
        Row: {
          con_push: boolean
          created_at: string
          employee_id: string
          entregado_at: string | null
          entregar_en: string
          id: number
          notificacion: Json | null
          push: Json | null
        }
        Insert: {
          con_push?: boolean
          created_at?: string
          employee_id: string
          entregado_at?: string | null
          entregar_en: string
          id?: never
          notificacion?: Json | null
          push?: Json | null
        }
        Update: {
          con_push?: boolean
          created_at?: string
          employee_id?: string
          entregado_at?: string | null
          entregar_en?: string
          id?: never
          notificacion?: Json | null
          push?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "avisos_diferidos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_diferidos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      avisos_emitidos: {
        Row: {
          clave: string
          created_at: string
          id: number
          recipient_id: string | null
        }
        Insert: {
          clave: string
          created_at?: string
          id?: never
          recipient_id?: string | null
        }
        Update: {
          clave?: string
          created_at?: string
          id?: never
          recipient_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "avisos_emitidos_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "avisos_emitidos_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_sync_log: {
        Row: {
          checked_at: string
          created_at: string
          error_msg: string | null
          id: number
          success: boolean
          tables_failed: number | null
          tables_ok: number | null
          total_kb: number | null
        }
        Insert: {
          checked_at?: string
          created_at?: string
          error_msg?: string | null
          id?: number
          success: boolean
          tables_failed?: number | null
          tables_ok?: number | null
          total_kb?: number | null
        }
        Update: {
          checked_at?: string
          created_at?: string
          error_msg?: string | null
          id?: number
          success?: boolean
          tables_failed?: number | null
          tables_ok?: number | null
          total_kb?: number | null
        }
        Relationships: []
      }
      bancos: {
        Row: {
          activo: boolean
          created_at: string
          id: number
          nombre: string
          orden: number
        }
        Insert: {
          activo?: boolean
          created_at?: string
          id?: never
          nombre: string
          orden?: number
        }
        Update: {
          activo?: boolean
          created_at?: string
          id?: never
          nombre?: string
          orden?: number
        }
        Relationships: []
      }
      banner_portal: {
        Row: {
          activo: boolean
          cambiado_at: string
          cambiado_por: string | null
          created_at: string
          id: number
          texto: string
          texto_corto: string | null
          variante: string
        }
        Insert: {
          activo?: boolean
          cambiado_at?: string
          cambiado_por?: string | null
          created_at?: string
          id?: number
          texto?: string
          texto_corto?: string | null
          variante?: string
        }
        Update: {
          activo?: boolean
          cambiado_at?: string
          cambiado_por?: string | null
          created_at?: string
          id?: number
          texto?: string
          texto_corto?: string | null
          variante?: string
        }
        Relationships: []
      }
      bitacora_areas: {
        Row: {
          activa: boolean
          branch_id: number
          calibrado_el: string | null
          calibrado_hasta: string | null
          created_at: string
          dias_semana: number[]
          franjas: Json
          hr_max: number | null
          hr_min: number | null
          id: number
          instrumento: string | null
          limpiezas: Json
          mide_humedad: boolean
          nombre: string
          notas: string | null
          puntos: Json
          temp_max: number | null
          temp_min: number | null
          tipo: string
          updated_at: string
          vigente_desde: string
        }
        Insert: {
          activa?: boolean
          branch_id: number
          calibrado_el?: string | null
          calibrado_hasta?: string | null
          created_at?: string
          dias_semana?: number[]
          franjas?: Json
          hr_max?: number | null
          hr_min?: number | null
          id?: never
          instrumento?: string | null
          limpiezas?: Json
          mide_humedad?: boolean
          nombre: string
          notas?: string | null
          puntos?: Json
          temp_max?: number | null
          temp_min?: number | null
          tipo: string
          updated_at?: string
          vigente_desde?: string
        }
        Update: {
          activa?: boolean
          branch_id?: number
          calibrado_el?: string | null
          calibrado_hasta?: string | null
          created_at?: string
          dias_semana?: number[]
          franjas?: Json
          hr_max?: number | null
          hr_min?: number | null
          id?: never
          instrumento?: string | null
          limpiezas?: Json
          mide_humedad?: boolean
          nombre?: string
          notas?: string | null
          puntos?: Json
          temp_max?: number | null
          temp_min?: number | null
          tipo?: string
          updated_at?: string
          vigente_desde?: string
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_areas_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_cierres: {
        Row: {
          accion: string
          actor_id: string
          branch_id: number
          created_at: string
          id: number
          motivo: string | null
          periodo: string
          resumen: Json | null
        }
        Insert: {
          accion: string
          actor_id: string
          branch_id: number
          created_at?: string
          id?: never
          motivo?: string | null
          periodo: string
          resumen?: Json | null
        }
        Update: {
          accion?: string
          actor_id?: string
          branch_id?: number
          created_at?: string
          id?: never
          motivo?: string | null
          periodo?: string
          resumen?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_cierres_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_cierres_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_cierres_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_correcciones: {
        Row: {
          accion_antes: string | null
          accion_despues: string | null
          corregido_por: string
          created_at: string
          humedad_antes: number | null
          humedad_despues: number | null
          id: number
          lectura_id: number
          motivo: string
          temperatura_antes: number | null
          temperatura_despues: number | null
        }
        Insert: {
          accion_antes?: string | null
          accion_despues?: string | null
          corregido_por: string
          created_at?: string
          humedad_antes?: number | null
          humedad_despues?: number | null
          id?: never
          lectura_id: number
          motivo: string
          temperatura_antes?: number | null
          temperatura_despues?: number | null
        }
        Update: {
          accion_antes?: string | null
          accion_despues?: string | null
          corregido_por?: string
          created_at?: string
          humedad_antes?: number | null
          humedad_despues?: number | null
          id?: never
          lectura_id?: number
          motivo?: string
          temperatura_antes?: number | null
          temperatura_despues?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_correcciones_corregido_por_fkey"
            columns: ["corregido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_correcciones_corregido_por_fkey"
            columns: ["corregido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_correcciones_lectura_id_fkey"
            columns: ["lectura_id"]
            isOneToOne: false
            referencedRelation: "bitacora_lecturas"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_dispensaciones: {
        Row: {
          anio: number
          anulada_at: string | null
          anulada_por: string | null
          branch_id: number
          cantidad: number
          clase: string
          cliente_texto: string | null
          cod_vendedor: string | null
          codigo_generacion: string | null
          completada_at: string | null
          completada_por: string | null
          correlativo_doc: string | null
          created_at: string
          customer_id: number | null
          detalle_anulacion: string | null
          documento_estado: string | null
          erp_product_id: number | null
          estado: string
          fecha: string
          fecha_vencimiento: string | null
          folio: number
          folio_txt: string | null
          hora: string | null
          id: number
          invoice_id: number
          laboratorio: string | null
          lote: string | null
          motivo_anulacion: string | null
          notas: string | null
          presentacion: string | null
          producto_nombre: string
          receta_item_id: number | null
          sales_invoice_item_id: number
          tipo_documento: string | null
          updated_at: string
          vendedor_nombre: string | null
        }
        Insert: {
          anio: number
          anulada_at?: string | null
          anulada_por?: string | null
          branch_id: number
          cantidad: number
          clase?: string
          cliente_texto?: string | null
          cod_vendedor?: string | null
          codigo_generacion?: string | null
          completada_at?: string | null
          completada_por?: string | null
          correlativo_doc?: string | null
          created_at?: string
          customer_id?: number | null
          detalle_anulacion?: string | null
          documento_estado?: string | null
          erp_product_id?: number | null
          estado?: string
          fecha: string
          fecha_vencimiento?: string | null
          folio: number
          folio_txt?: string | null
          hora?: string | null
          id?: never
          invoice_id: number
          laboratorio?: string | null
          lote?: string | null
          motivo_anulacion?: string | null
          notas?: string | null
          presentacion?: string | null
          producto_nombre: string
          receta_item_id?: number | null
          sales_invoice_item_id: number
          tipo_documento?: string | null
          updated_at?: string
          vendedor_nombre?: string | null
        }
        Update: {
          anio?: number
          anulada_at?: string | null
          anulada_por?: string | null
          branch_id?: number
          cantidad?: number
          clase?: string
          cliente_texto?: string | null
          cod_vendedor?: string | null
          codigo_generacion?: string | null
          completada_at?: string | null
          completada_por?: string | null
          correlativo_doc?: string | null
          created_at?: string
          customer_id?: number | null
          detalle_anulacion?: string | null
          documento_estado?: string | null
          erp_product_id?: number | null
          estado?: string
          fecha?: string
          fecha_vencimiento?: string | null
          folio?: number
          folio_txt?: string | null
          hora?: string | null
          id?: never
          invoice_id?: number
          laboratorio?: string | null
          lote?: string | null
          motivo_anulacion?: string | null
          notas?: string | null
          presentacion?: string | null
          producto_nombre?: string
          receta_item_id?: number | null
          sales_invoice_item_id?: number
          tipo_documento?: string | null
          updated_at?: string
          vendedor_nombre?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_dispensaciones_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_completada_por_fkey"
            columns: ["completada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_completada_por_fkey"
            columns: ["completada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_receta_item_id_fkey"
            columns: ["receta_item_id"]
            isOneToOne: false
            referencedRelation: "receta_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_dispensaciones_sales_invoice_item_id_fkey"
            columns: ["sales_invoice_item_id"]
            isOneToOne: true
            referencedRelation: "sales_invoice_items"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_folios: {
        Row: {
          anio: number
          branch_id: number
          serie: string
          ultimo: number
        }
        Insert: {
          anio: number
          branch_id: number
          serie: string
          ultimo?: number
        }
        Update: {
          anio?: number
          branch_id?: number
          serie?: string
          ultimo?: number
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_folios_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_lecturas: {
        Row: {
          accion_correctiva: string | null
          area_id: number
          created_at: string
          fecha: string
          franja: string
          fuera_de_rango: boolean
          humedad: number | null
          id: number
          registrado_at: string
          registrado_por: string
          tarde: boolean
          temperatura: number
        }
        Insert: {
          accion_correctiva?: string | null
          area_id: number
          created_at?: string
          fecha: string
          franja: string
          fuera_de_rango?: boolean
          humedad?: number | null
          id?: never
          registrado_at?: string
          registrado_por: string
          tarde?: boolean
          temperatura: number
        }
        Update: {
          accion_correctiva?: string | null
          area_id?: number
          created_at?: string
          fecha?: string
          franja?: string
          fuera_de_rango?: boolean
          humedad?: number | null
          id?: never
          registrado_at?: string
          registrado_por?: string
          tarde?: boolean
          temperatura?: number
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_lecturas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "bitacora_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_lecturas_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_lecturas_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_limpiezas: {
        Row: {
          area_id: number
          correccion_motivo: string | null
          corregida_at: string | null
          corregida_por: string | null
          created_at: string
          fecha: string
          id: number
          observaciones: string | null
          puntos: Json
          realizada_por: string
          registrado_at: string
          tarde: boolean
          turno: string
        }
        Insert: {
          area_id: number
          correccion_motivo?: string | null
          corregida_at?: string | null
          corregida_por?: string | null
          created_at?: string
          fecha: string
          id?: never
          observaciones?: string | null
          puntos?: Json
          realizada_por: string
          registrado_at?: string
          tarde?: boolean
          turno: string
        }
        Update: {
          area_id?: number
          correccion_motivo?: string | null
          corregida_at?: string | null
          corregida_por?: string | null
          created_at?: string
          fecha?: string
          id?: never
          observaciones?: string | null
          puntos?: Json
          realizada_por?: string
          registrado_at?: string
          tarde?: boolean
          turno?: string
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_limpiezas_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "bitacora_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_corregida_por_fkey"
            columns: ["corregida_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_corregida_por_fkey"
            columns: ["corregida_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_realizada_por_fkey"
            columns: ["realizada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_realizada_por_fkey"
            columns: ["realizada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bitacora_limpiezas_historial: {
        Row: {
          accion: string
          actor_id: string | null
          area_id: number
          created_at: string
          fecha: string
          id: number
          limpieza_id: number | null
          motivo: string
          observaciones_antes: string | null
          observaciones_despues: string | null
          puntos_antes: Json | null
          puntos_despues: Json | null
          realizada_por: string | null
          registrado_at_antes: string | null
          tarde_antes: boolean | null
          turno: string
        }
        Insert: {
          accion: string
          actor_id?: string | null
          area_id: number
          created_at?: string
          fecha: string
          id?: never
          limpieza_id?: number | null
          motivo: string
          observaciones_antes?: string | null
          observaciones_despues?: string | null
          puntos_antes?: Json | null
          puntos_despues?: Json | null
          realizada_por?: string | null
          registrado_at_antes?: string | null
          tarde_antes?: boolean | null
          turno: string
        }
        Update: {
          accion?: string
          actor_id?: string | null
          area_id?: number
          created_at?: string
          fecha?: string
          id?: never
          limpieza_id?: number | null
          motivo?: string
          observaciones_antes?: string | null
          observaciones_despues?: string | null
          puntos_antes?: Json | null
          puntos_despues?: Json | null
          realizada_por?: string | null
          registrado_at_antes?: string | null
          tarde_antes?: boolean | null
          turno?: string
        }
        Relationships: [
          {
            foreignKeyName: "bitacora_limpiezas_historial_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_historial_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_historial_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "bitacora_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_historial_realizada_por_fkey"
            columns: ["realizada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bitacora_limpiezas_historial_realizada_por_fkey"
            columns: ["realizada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bolsa_faltante: {
        Row: {
          cantidad: number
          created_at: string
          declarado_at: string
          declarado_por: string | null
          descripcion: string | null
          destino_branch_id: number | null
          erp_product_id: number | null
          estado: string
          familia: string
          id: string
          nota: string | null
          origen_branch_id: number | null
          posicion: number
          presentacion_tipo: string | null
          recordado_dias: number
          request_id: string
          resolucion: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          updated_at: string
        }
        Insert: {
          cantidad: number
          created_at?: string
          declarado_at?: string
          declarado_por?: string | null
          descripcion?: string | null
          destino_branch_id?: number | null
          erp_product_id?: number | null
          estado?: string
          familia: string
          id?: string
          nota?: string | null
          origen_branch_id?: number | null
          posicion: number
          presentacion_tipo?: string | null
          recordado_dias?: number
          request_id: string
          resolucion?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          updated_at?: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          declarado_at?: string
          declarado_por?: string | null
          descripcion?: string | null
          destino_branch_id?: number | null
          erp_product_id?: number | null
          estado?: string
          familia?: string
          id?: string
          nota?: string | null
          origen_branch_id?: number | null
          posicion?: number
          presentacion_tipo?: string | null
          recordado_dias?: number
          request_id?: string
          resolucion?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bolsa_faltante_declarado_por_fkey"
            columns: ["declarado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsa_faltante_declarado_por_fkey"
            columns: ["declarado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsa_faltante_destino_branch_id_fkey"
            columns: ["destino_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsa_faltante_origen_branch_id_fkey"
            columns: ["origen_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsa_faltante_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsa_faltante_resuelto_por_fkey"
            columns: ["resuelto_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsa_faltante_resuelto_por_fkey"
            columns: ["resuelto_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bolsas: {
        Row: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          caja: string | null
          cerrada_at: string
          cerrada_por: string | null
          contado: number | null
          contado_at: string | null
          contado_por: string | null
          conteo_id: number | null
          conteo_marcado: number | null
          conteo_marcado_at: string | null
          conteo_marcado_por: string | null
          corte_id: number | null
          created_at: string
          deposito_id: number | null
          dif_at: string | null
          dif_causa: string | null
          dif_foto_url: string | null
          dif_por: string | null
          dif_via: string | null
          entrega_id: number | null
          entregada_at: string | null
          entregada_por: string | null
          estado: string
          etiqueta_impresa_at: string | null
          etiqueta_version: number
          fecha: string
          folio: string
          hora: string
          id: number
          monto_inicial: number
          motivo_origen: string | null
          origen: string
          recibida_at: string | null
          recibida_por: string | null
          updated_at: string
        }
        Insert: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          branch_id: number
          caja?: string | null
          cerrada_at?: string
          cerrada_por?: string | null
          contado?: number | null
          contado_at?: string | null
          contado_por?: string | null
          conteo_id?: number | null
          conteo_marcado?: number | null
          conteo_marcado_at?: string | null
          conteo_marcado_por?: string | null
          corte_id?: number | null
          created_at?: string
          deposito_id?: number | null
          dif_at?: string | null
          dif_causa?: string | null
          dif_foto_url?: string | null
          dif_por?: string | null
          dif_via?: string | null
          entrega_id?: number | null
          entregada_at?: string | null
          entregada_por?: string | null
          estado?: string
          etiqueta_impresa_at?: string | null
          etiqueta_version?: number
          fecha: string
          folio: string
          hora: string
          id?: number
          monto_inicial: number
          motivo_origen?: string | null
          origen?: string
          recibida_at?: string | null
          recibida_por?: string | null
          updated_at?: string
        }
        Update: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          branch_id?: number
          caja?: string | null
          cerrada_at?: string
          cerrada_por?: string | null
          contado?: number | null
          contado_at?: string | null
          contado_por?: string | null
          conteo_id?: number | null
          conteo_marcado?: number | null
          conteo_marcado_at?: string | null
          conteo_marcado_por?: string | null
          corte_id?: number | null
          created_at?: string
          deposito_id?: number | null
          dif_at?: string | null
          dif_causa?: string | null
          dif_foto_url?: string | null
          dif_por?: string | null
          dif_via?: string | null
          entrega_id?: number | null
          entregada_at?: string | null
          entregada_por?: string | null
          estado?: string
          etiqueta_impresa_at?: string | null
          etiqueta_version?: number
          fecha?: string
          folio?: string
          hora?: string
          id?: number
          monto_inicial?: number
          motivo_origen?: string | null
          origen?: string
          recibida_at?: string | null
          recibida_por?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_cerrada_por_fkey"
            columns: ["cerrada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_cerrada_por_fkey"
            columns: ["cerrada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_contado_por_fkey"
            columns: ["contado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_contado_por_fkey"
            columns: ["contado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_conteo_id_fkey"
            columns: ["conteo_id"]
            isOneToOne: false
            referencedRelation: "bolsas_conteos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_conteo_marcado_por_fkey"
            columns: ["conteo_marcado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_conteo_marcado_por_fkey"
            columns: ["conteo_marcado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_corte_id_fkey"
            columns: ["corte_id"]
            isOneToOne: false
            referencedRelation: "cortes_caja"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_deposito_id_fkey"
            columns: ["deposito_id"]
            isOneToOne: false
            referencedRelation: "depositos_bancarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_dif_por_fkey"
            columns: ["dif_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_dif_por_fkey"
            columns: ["dif_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entrega_id_fkey"
            columns: ["entrega_id"]
            isOneToOne: false
            referencedRelation: "bolsas_entregas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregada_por_fkey"
            columns: ["entregada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregada_por_fkey"
            columns: ["entregada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_recibida_por_fkey"
            columns: ["recibida_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_recibida_por_fkey"
            columns: ["recibida_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bolsas_conteos: {
        Row: {
          cerrado_at: string
          cerrado_por: string | null
          created_at: string
          cuantas: number
          descuadradas: number
          diferencia: number
          fecha: string
          folio: string
          id: number
          total_contado: number
          total_esperado: number
        }
        Insert: {
          cerrado_at?: string
          cerrado_por?: string | null
          created_at?: string
          cuantas?: number
          descuadradas?: number
          diferencia?: number
          fecha: string
          folio: string
          id?: never
          total_contado?: number
          total_esperado?: number
        }
        Update: {
          cerrado_at?: string
          cerrado_por?: string | null
          created_at?: string
          cuantas?: number
          descuadradas?: number
          diferencia?: number
          fecha?: string
          folio?: string
          id?: never
          total_contado?: number
          total_esperado?: number
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_conteos_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_conteos_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bolsas_entidades: {
        Row: {
          activo: boolean
          created_at: string
          id: number
          nombre: string
          orden: number
          tipo: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          id?: never
          nombre: string
          orden?: number
          tipo: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          id?: never
          nombre?: string
          orden?: number
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_entidades_tipo_fkey"
            columns: ["tipo"]
            isOneToOne: false
            referencedRelation: "bolsas_tipos_salida"
            referencedColumns: ["codigo"]
          },
        ]
      }
      bolsas_entregas: {
        Row: {
          branch_id: number
          confirmada_at: string | null
          confirmada_por: string | null
          created_at: string
          entregada_at: string
          entregada_por: string | null
          folio: string
          id: number
          recibido_metodo: string
          recibido_por: string
        }
        Insert: {
          branch_id: number
          confirmada_at?: string | null
          confirmada_por?: string | null
          created_at?: string
          entregada_at?: string
          entregada_por?: string | null
          folio: string
          id?: never
          recibido_metodo: string
          recibido_por: string
        }
        Update: {
          branch_id?: number
          confirmada_at?: string | null
          confirmada_por?: string | null
          created_at?: string
          entregada_at?: string
          entregada_por?: string | null
          folio?: string
          id?: never
          recibido_metodo?: string
          recibido_por?: string
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_entregas_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregas_confirmada_por_fkey"
            columns: ["confirmada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregas_confirmada_por_fkey"
            columns: ["confirmada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregas_entregada_por_fkey"
            columns: ["entregada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregas_entregada_por_fkey"
            columns: ["entregada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregas_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_entregas_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bolsas_eventos: {
        Row: {
          accion: string
          bolsa_id: number
          created_at: string
          employee_id: string | null
          estado_antes: string | null
          estado_despues: string | null
          id: number
          monto: number | null
          motivo: string | null
          nota: string | null
        }
        Insert: {
          accion: string
          bolsa_id: number
          created_at?: string
          employee_id?: string | null
          estado_antes?: string | null
          estado_despues?: string | null
          id?: number
          monto?: number | null
          motivo?: string | null
          nota?: string | null
        }
        Update: {
          accion?: string
          bolsa_id?: number
          created_at?: string
          employee_id?: string | null
          estado_antes?: string | null
          estado_despues?: string | null
          id?: number
          monto?: number | null
          motivo?: string | null
          nota?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_eventos_bolsa_id_fkey"
            columns: ["bolsa_id"]
            isOneToOne: false
            referencedRelation: "bolsas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_eventos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_eventos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bolsas_movimientos: {
        Row: {
          anulado_at: string | null
          anulado_motivo: string | null
          anulado_por: string | null
          bolsa_id: number
          caja_vale_id: number | null
          created_at: string
          id: number
          impreso_at: string | null
          monto: number
          operacion_id: number | null
          registrado_at: string
          registrado_por: string | null
          vale_folio: string
        }
        Insert: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          bolsa_id: number
          caja_vale_id?: number | null
          created_at?: string
          id?: number
          impreso_at?: string | null
          monto: number
          operacion_id?: number | null
          registrado_at?: string
          registrado_por?: string | null
          vale_folio: string
        }
        Update: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          bolsa_id?: number
          caja_vale_id?: number | null
          created_at?: string
          id?: number
          impreso_at?: string | null
          monto?: number
          operacion_id?: number | null
          registrado_at?: string
          registrado_por?: string | null
          vale_folio?: string
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_movimientos_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_movimientos_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_movimientos_bolsa_id_fkey"
            columns: ["bolsa_id"]
            isOneToOne: false
            referencedRelation: "bolsas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_movimientos_caja_vale_id_fkey"
            columns: ["caja_vale_id"]
            isOneToOne: false
            referencedRelation: "caja_vales_portal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_movimientos_operacion_id_fkey"
            columns: ["operacion_id"]
            isOneToOne: false
            referencedRelation: "bolsas_operaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_movimientos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_movimientos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bolsas_operaciones: {
        Row: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          created_at: string
          entidad: string | null
          folio: string
          foto_lectura: Json | null
          foto_url: string | null
          id: number
          monto: number
          monto_origen: string | null
          nota: string | null
          numero_boleta: string | null
          recibido_metodo: string | null
          recibido_por: string | null
          registrado_at: string
          registrado_por: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          branch_id: number
          created_at?: string
          entidad?: string | null
          folio: string
          foto_lectura?: Json | null
          foto_url?: string | null
          id?: number
          monto: number
          monto_origen?: string | null
          nota?: string | null
          numero_boleta?: string | null
          recibido_metodo?: string | null
          recibido_por?: string | null
          registrado_at?: string
          registrado_por?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          branch_id?: number
          created_at?: string
          entidad?: string | null
          folio?: string
          foto_lectura?: Json | null
          foto_url?: string | null
          id?: number
          monto?: number
          monto_origen?: string | null
          nota?: string | null
          numero_boleta?: string | null
          recibido_metodo?: string | null
          recibido_por?: string | null
          registrado_at?: string
          registrado_por?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_operaciones_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_operaciones_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_operaciones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_operaciones_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_operaciones_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_operaciones_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_operaciones_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bolsas_operaciones_tipo_fkey"
            columns: ["tipo"]
            isOneToOne: false
            referencedRelation: "bolsas_tipos_salida"
            referencedColumns: ["codigo"]
          },
        ]
      }
      bolsas_tipos_salida: {
        Row: {
          activo: boolean
          caja_tipo: string | null
          codigo: string
          created_at: string
          entidad_la_dice_el_papel: boolean
          etiqueta: string
          etiqueta_entidad: string | null
          foto: string
          leyenda: string | null
          multiplo: number | null
          orden: number
          pide_boleta: boolean
          pide_receptor: boolean
          prefijo: string
          signo: number
        }
        Insert: {
          activo?: boolean
          caja_tipo?: string | null
          codigo: string
          created_at?: string
          entidad_la_dice_el_papel?: boolean
          etiqueta: string
          etiqueta_entidad?: string | null
          foto?: string
          leyenda?: string | null
          multiplo?: number | null
          orden?: number
          pide_boleta?: boolean
          pide_receptor?: boolean
          prefijo: string
          signo?: number
        }
        Update: {
          activo?: boolean
          caja_tipo?: string | null
          codigo?: string
          created_at?: string
          entidad_la_dice_el_papel?: boolean
          etiqueta?: string
          etiqueta_entidad?: string | null
          foto?: string
          leyenda?: string | null
          multiplo?: number | null
          orden?: number
          pide_boleta?: boolean
          pide_receptor?: boolean
          prefijo?: string
          signo?: number
        }
        Relationships: [
          {
            foreignKeyName: "bolsas_tipos_salida_caja_tipo_fkey"
            columns: ["caja_tipo"]
            isOneToOne: false
            referencedRelation: "caja_tipos_movimiento"
            referencedColumns: ["codigo"]
          },
        ]
      }
      bono_semestre: {
        Row: {
          aprobado_at: string | null
          aprobado_por: string | null
          created_at: string
          estado: string
          id: number
          nota: string | null
          semestre: string
          updated_at: string
        }
        Insert: {
          aprobado_at?: string | null
          aprobado_por?: string | null
          created_at?: string
          estado?: string
          id?: never
          nota?: string | null
          semestre: string
          updated_at?: string
        }
        Update: {
          aprobado_at?: string | null
          aprobado_por?: string | null
          created_at?: string
          estado?: string
          id?: never
          nota?: string | null
          semestre?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bono_semestre_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      bono_semestre_decision: {
        Row: {
          created_at: string
          decidido_at: string
          decidido_por: string
          employee_id: string
          id: number
          motivo: string
          pagar: boolean
          semestre_id: number
        }
        Insert: {
          created_at?: string
          decidido_at?: string
          decidido_por: string
          employee_id: string
          id?: never
          motivo: string
          pagar: boolean
          semestre_id: number
        }
        Update: {
          created_at?: string
          decidido_at?: string
          decidido_por?: string
          employee_id?: string
          id?: never
          motivo?: string
          pagar?: boolean
          semestre_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "bono_semestre_decision_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_decision_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_decision_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_decision_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_decision_semestre_id_fkey"
            columns: ["semestre_id"]
            isOneToOne: false
            referencedRelation: "bono_semestre"
            referencedColumns: ["id"]
          },
        ]
      }
      bono_semestre_detalle: {
        Row: {
          created_at: string
          employee_id: string
          id: number
          pagar: boolean
          por_mes: Json
          semestre_id: number
          status_al_aprobar: string
          total: number
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: never
          pagar: boolean
          por_mes: Json
          semestre_id: number
          status_al_aprobar: string
          total: number
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: never
          pagar?: boolean
          por_mes?: Json
          semestre_id?: number
          status_al_aprobar?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "bono_semestre_detalle_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_detalle_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_detalle_semestre_id_fkey"
            columns: ["semestre_id"]
            isOneToOne: false
            referencedRelation: "bono_semestre"
            referencedColumns: ["id"]
          },
        ]
      }
      bono_semestre_historial: {
        Row: {
          actor: string | null
          created_at: string
          employee_id: string | null
          evento: string
          id: number
          nota: string | null
          semestre_id: number
          valor: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          employee_id?: string | null
          evento: string
          id?: never
          nota?: string | null
          semestre_id: number
          valor?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          employee_id?: string | null
          evento?: string
          id?: never
          nota?: string | null
          semestre_id?: number
          valor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bono_semestre_historial_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_historial_actor_fkey"
            columns: ["actor"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_historial_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_historial_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bono_semestre_historial_semestre_id_fkey"
            columns: ["semestre_id"]
            isOneToOne: false
            referencedRelation: "bono_semestre"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_documents: {
        Row: {
          branch_id: number
          created_at: string | null
          document_type: string
          expiration_date: string | null
          file_url: string | null
          id: number
          issue_date: string | null
          metadata: Json | null
          name: string
          status: string | null
        }
        Insert: {
          branch_id: number
          created_at?: string | null
          document_type: string
          expiration_date?: string | null
          file_url?: string | null
          id?: number
          issue_date?: string | null
          metadata?: Json | null
          name: string
          status?: string | null
        }
        Update: {
          branch_id?: number
          created_at?: string | null
          document_type?: string
          expiration_date?: string | null
          file_url?: string | null
          id?: number
          issue_date?: string | null
          metadata?: Json | null
          name?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_documents_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_expenses: {
        Row: {
          amount: number
          billing_month: string
          branch_id: number
          created_at: string | null
          due_date: string
          expense_type: string
          id: number
          notes: string | null
          paid_at: string | null
          receipt_url: string | null
          status: string | null
        }
        Insert: {
          amount: number
          billing_month: string
          branch_id: number
          created_at?: string | null
          due_date: string
          expense_type: string
          id?: number
          notes?: string | null
          paid_at?: string | null
          receipt_url?: string | null
          status?: string | null
        }
        Update: {
          amount?: number
          billing_month?: string
          branch_id?: number
          created_at?: string | null
          due_date?: string
          expense_type?: string
          id?: number
          notes?: string | null
          paid_at?: string | null
          receipt_url?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branch_expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          address: string | null
          cell: string | null
          codigo: string | null
          codigo_puntos: string | null
          codigo_puntos_previo: string | null
          conteo_ciclico_activo: boolean
          conteo_ciclico_tamano: number
          created_at: string
          id: number
          libro_receta_desde: string | null
          name: string
          opening_date: string | null
          phone: string | null
          sala_respaldo_id: number | null
          settings: Json | null
          type: string
          weekly_hours: Json | null
        }
        Insert: {
          address?: string | null
          cell?: string | null
          codigo?: string | null
          codigo_puntos?: string | null
          codigo_puntos_previo?: string | null
          conteo_ciclico_activo?: boolean
          conteo_ciclico_tamano?: number
          created_at?: string
          id?: number
          libro_receta_desde?: string | null
          name: string
          opening_date?: string | null
          phone?: string | null
          sala_respaldo_id?: number | null
          settings?: Json | null
          type?: string
          weekly_hours?: Json | null
        }
        Update: {
          address?: string | null
          cell?: string | null
          codigo?: string | null
          codigo_puntos?: string | null
          codigo_puntos_previo?: string | null
          conteo_ciclico_activo?: boolean
          conteo_ciclico_tamano?: number
          created_at?: string
          id?: number
          libro_receta_desde?: string | null
          name?: string
          opening_date?: string | null
          phone?: string | null
          sala_respaldo_id?: number | null
          settings?: Json | null
          type?: string
          weekly_hours?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_sala_respaldo_id_fkey"
            columns: ["sala_respaldo_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      caja_aperturas_del_portal: {
        Row: {
          abierta_por: string
          branch_id: number
          caja_erp: number | null
          created_at: string
          erp_apertura_id: number | null
          erp_empleado_id: number | null
          id: number
          monto_apertura: number
        }
        Insert: {
          abierta_por: string
          branch_id: number
          caja_erp?: number | null
          created_at?: string
          erp_apertura_id?: number | null
          erp_empleado_id?: number | null
          id?: never
          monto_apertura?: number
        }
        Update: {
          abierta_por?: string
          branch_id?: number
          caja_erp?: number | null
          created_at?: string
          erp_apertura_id?: number | null
          erp_empleado_id?: number | null
          id?: never
          monto_apertura?: number
        }
        Relationships: [
          {
            foreignKeyName: "caja_aperturas_del_portal_abierta_por_fkey"
            columns: ["abierta_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_aperturas_del_portal_abierta_por_fkey"
            columns: ["abierta_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_aperturas_del_portal_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      caja_cierres_automaticos: {
        Row: {
          branch_id: number
          corte_hora: string | null
          created_at: string
          detalle: Json
          erp_corte_id: number | null
          falta: number | null
          fecha: string
          id: number
          motivo: string | null
          resultado: string
          updated_at: string
        }
        Insert: {
          branch_id: number
          corte_hora?: string | null
          created_at?: string
          detalle?: Json
          erp_corte_id?: number | null
          falta?: number | null
          fecha: string
          id?: never
          motivo?: string | null
          resultado: string
          updated_at?: string
        }
        Update: {
          branch_id?: number
          corte_hora?: string | null
          created_at?: string
          detalle?: Json
          erp_corte_id?: number | null
          falta?: number | null
          fecha?: string
          id?: never
          motivo?: string | null
          resultado?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "caja_cierres_automaticos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      caja_cortes_del_portal: {
        Row: {
          branch_id: number
          created_at: string
          erp_corte_id: number
          hecho_por: string
          id: number
          tipo: string
        }
        Insert: {
          branch_id: number
          created_at?: string
          erp_corte_id: number
          hecho_por: string
          id?: never
          tipo: string
        }
        Update: {
          branch_id?: number
          created_at?: string
          erp_corte_id?: number
          hecho_por?: string
          id?: never
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "caja_cortes_del_portal_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_cortes_del_portal_hecho_por_fkey"
            columns: ["hecho_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_cortes_del_portal_hecho_por_fkey"
            columns: ["hecho_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      caja_movimientos_portal: {
        Row: {
          anulado_at: string | null
          anulado_motivo: string | null
          anulado_por: string | null
          branch_id: number
          clave_envio: string | null
          concepto: string
          created_at: string
          detalle: string | null
          erp_apertura_id: number | null
          erp_movimiento_id: number | null
          fecha: string
          foto_lectura: Json | null
          foto_url: string | null
          id: number
          monto: number
          monto_origen: string | null
          numero_boleta: string | null
          recibido_metodo: string | null
          recibido_por: string | null
          recibido_texto: string | null
          registrado_at: string
          registrado_por: string
          tipo: string
          tipo_codigo: string | null
          updated_at: string
        }
        Insert: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          branch_id: number
          clave_envio?: string | null
          concepto: string
          created_at?: string
          detalle?: string | null
          erp_apertura_id?: number | null
          erp_movimiento_id?: number | null
          fecha: string
          foto_lectura?: Json | null
          foto_url?: string | null
          id?: never
          monto: number
          monto_origen?: string | null
          numero_boleta?: string | null
          recibido_metodo?: string | null
          recibido_por?: string | null
          recibido_texto?: string | null
          registrado_at?: string
          registrado_por: string
          tipo: string
          tipo_codigo?: string | null
          updated_at?: string
        }
        Update: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          branch_id?: number
          clave_envio?: string | null
          concepto?: string
          created_at?: string
          detalle?: string | null
          erp_apertura_id?: number | null
          erp_movimiento_id?: number | null
          fecha?: string
          foto_lectura?: Json | null
          foto_url?: string | null
          id?: never
          monto?: number
          monto_origen?: string | null
          numero_boleta?: string | null
          recibido_metodo?: string | null
          recibido_por?: string | null
          recibido_texto?: string | null
          registrado_at?: string
          registrado_por?: string
          tipo?: string
          tipo_codigo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "caja_movimientos_portal_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_movimientos_portal_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_movimientos_portal_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_movimientos_portal_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_movimientos_portal_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_movimientos_portal_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_movimientos_portal_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_movimientos_portal_tipo_codigo_fkey"
            columns: ["tipo_codigo"]
            isOneToOne: false
            referencedRelation: "caja_tipos_movimiento"
            referencedColumns: ["codigo"]
          },
        ]
      }
      caja_tipos_movimiento: {
        Row: {
          activo: boolean
          codigo: string
          created_at: string
          etiqueta: string
          foto: string
          identifica_receptor: boolean
          leyenda: string | null
          lleva_comprobante: boolean
          orden: number
          pide_boleta: boolean
          pide_persona: boolean
          sentido: string
        }
        Insert: {
          activo?: boolean
          codigo: string
          created_at?: string
          etiqueta: string
          foto?: string
          identifica_receptor?: boolean
          leyenda?: string | null
          lleva_comprobante?: boolean
          orden?: number
          pide_boleta?: boolean
          pide_persona?: boolean
          sentido: string
        }
        Update: {
          activo?: boolean
          codigo?: string
          created_at?: string
          etiqueta?: string
          foto?: string
          identifica_receptor?: boolean
          leyenda?: string | null
          lleva_comprobante?: boolean
          orden?: number
          pide_boleta?: boolean
          pide_persona?: boolean
          sentido?: string
        }
        Relationships: []
      }
      caja_vales_portal: {
        Row: {
          anotado_at: string | null
          anotado_por: string | null
          branch_id: number
          cerrado_at: string | null
          corte_id_al_abrir: number | null
          created_at: string
          erp_movimiento_id: number | null
          estado: string
          fecha: string
          id: number
          intentos: number
          monto: number
          ultimo_error: string | null
          updated_at: string
        }
        Insert: {
          anotado_at?: string | null
          anotado_por?: string | null
          branch_id: number
          cerrado_at?: string | null
          corte_id_al_abrir?: number | null
          created_at?: string
          erp_movimiento_id?: number | null
          estado?: string
          fecha: string
          id?: never
          intentos?: number
          monto?: number
          ultimo_error?: string | null
          updated_at?: string
        }
        Update: {
          anotado_at?: string | null
          anotado_por?: string | null
          branch_id?: number
          cerrado_at?: string | null
          corte_id_al_abrir?: number | null
          created_at?: string
          erp_movimiento_id?: number | null
          estado?: string
          fecha?: string
          id?: never
          intentos?: number
          monto?: number
          ultimo_error?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "caja_vales_portal_anotado_por_fkey"
            columns: ["anotado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_vales_portal_anotado_por_fkey"
            columns: ["anotado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_vales_portal_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caja_vales_portal_corte_id_al_abrir_fkey"
            columns: ["corte_id_al_abrir"]
            isOneToOne: false
            referencedRelation: "cortes_caja"
            referencedColumns: ["id"]
          },
        ]
      }
      capturas_de_foto: {
        Row: {
          created_at: string
          employee_id: string | null
          foto_url: string | null
          id: string
          secreto_hash: string
          solicitada_por: string
          usada_el: string | null
          vence_el: string
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          foto_url?: string | null
          id?: string
          secreto_hash: string
          solicitada_por: string
          usada_el?: string | null
          vence_el: string
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          foto_url?: string | null
          id?: string
          secreto_hash?: string
          solicitada_por?: string
          usada_el?: string | null
          vence_el?: string
        }
        Relationships: [
          {
            foreignKeyName: "capturas_de_foto_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capturas_de_foto_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capturas_de_foto_solicitada_por_fkey"
            columns: ["solicitada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "capturas_de_foto_solicitada_por_fkey"
            columns: ["solicitada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      carnes_temporales: {
        Row: {
          anulado_el: string | null
          auth_user_id: string | null
          branch_id: number | null
          created_at: string
          emitido_por: string | null
          employee_id: string
          id: number
          impreso_en: number | null
          motivo: string | null
          secreto_hash: string
          vence_el: string
        }
        Insert: {
          anulado_el?: string | null
          auth_user_id?: string | null
          branch_id?: number | null
          created_at?: string
          emitido_por?: string | null
          employee_id: string
          id?: never
          impreso_en?: number | null
          motivo?: string | null
          secreto_hash: string
          vence_el: string
        }
        Update: {
          anulado_el?: string | null
          auth_user_id?: string | null
          branch_id?: number | null
          created_at?: string
          emitido_por?: string | null
          employee_id?: string
          id?: never
          impreso_en?: number | null
          motivo?: string | null
          secreto_hash?: string
          vence_el?: string
        }
        Relationships: [
          {
            foreignKeyName: "carnes_temporales_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carnes_temporales_emitido_por_fkey"
            columns: ["emitido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carnes_temporales_emitido_por_fkey"
            columns: ["emitido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carnes_temporales_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carnes_temporales_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carnes_temporales_impreso_en_fkey"
            columns: ["impreso_en"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes_por_revisar: {
        Row: {
          created_at: string
          customer_id: number | null
          datos: Json | null
          descartado_at: string | null
          descartado_por: string | null
          detalle: string | null
          erp_id: string | null
          id: number
          motivo: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: number | null
          datos?: Json | null
          descartado_at?: string | null
          descartado_por?: string | null
          detalle?: string | null
          erp_id?: string | null
          id?: never
          motivo: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: number | null
          datos?: Json | null
          descartado_at?: string | null
          descartado_por?: string | null
          detalle?: string | null
          erp_id?: string | null
          id?: never
          motivo?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_por_revisar_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_por_revisar_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      clientes_sin_producto: {
        Row: {
          created_at: string
          created_by: string | null
          customer_id: number
          motivo: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_id: number
          motivo: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_id?: number
          motivo?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_sin_producto_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_sin_producto_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      cola_impresion: {
        Row: {
          branch_id: number
          contenido: string
          creado_por: string | null
          created_at: string
          dispositivo: string | null
          error: string | null
          estado: string
          id: number
          impreso_at: string | null
          intentos: number
          reclamado_at: string | null
          titulo: string
        }
        Insert: {
          branch_id: number
          contenido: string
          creado_por?: string | null
          created_at?: string
          dispositivo?: string | null
          error?: string | null
          estado?: string
          id?: never
          impreso_at?: string | null
          intentos?: number
          reclamado_at?: string | null
          titulo: string
        }
        Update: {
          branch_id?: number
          contenido?: string
          creado_por?: string | null
          created_at?: string
          dispositivo?: string | null
          error?: string | null
          estado?: string
          id?: never
          impreso_at?: string | null
          intentos?: number
          reclamado_at?: string | null
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "cola_impresion_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cola_impresion_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cola_impresion_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cola_impresion_dispositivo_fkey"
            columns: ["dispositivo"]
            isOneToOne: false
            referencedRelation: "impresion_dispositivos"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_documento_leido: {
        Row: {
          document_id: number
          leido_at: string
          renglones: number
        }
        Insert: {
          document_id: number
          leido_at?: string
          renglones?: number
        }
        Update: {
          document_id?: number
          leido_at?: string
          renglones?: number
        }
        Relationships: [
          {
            foreignKeyName: "compra_documento_leido_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "compra_deuda_documentos"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "compra_documento_leido_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "purchase_dte_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_pago_aplicado: {
        Row: {
          created_at: string
          document_id: number
          id: number
          monto: number
          pago_id: number
        }
        Insert: {
          created_at?: string
          document_id: number
          id?: number
          monto: number
          pago_id: number
        }
        Update: {
          created_at?: string
          document_id?: number
          id?: number
          monto?: number
          pago_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "compra_pago_aplicado_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "compra_deuda_documentos"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "compra_pago_aplicado_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "purchase_dte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_pago_aplicado_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "compra_pagos"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_pagos: {
        Row: {
          anulado_at: string | null
          anulado_motivo: string | null
          anulado_por: string | null
          aprobado_at: string | null
          aprobado_por: string | null
          created_at: string
          emisor_nit: string
          estado: string
          fecha: string
          forma: string
          id: number
          monto: number
          nota: string | null
          referencia: string | null
          registrado_at: string
          registrado_por: string | null
        }
        Insert: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          aprobado_at?: string | null
          aprobado_por?: string | null
          created_at?: string
          emisor_nit: string
          estado?: string
          fecha: string
          forma: string
          id?: number
          monto: number
          nota?: string | null
          referencia?: string | null
          registrado_at?: string
          registrado_por?: string | null
        }
        Update: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          aprobado_at?: string | null
          aprobado_por?: string | null
          created_at?: string
          emisor_nit?: string
          estado?: string
          fecha?: string
          forma?: string
          id?: number
          monto?: number
          nota?: string | null
          referencia?: string | null
          registrado_at?: string
          registrado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compra_pagos_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_pagos_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_pagos_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_pagos_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_pagos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_pagos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_producto_alias: {
        Row: {
          codigo_proveedor: string
          confirmado_por: string | null
          created_at: string
          emisor_nit: string
          id: number
          origen: string
          product_id: number
          updated_at: string
          veces_usado: number
        }
        Insert: {
          codigo_proveedor: string
          confirmado_por?: string | null
          created_at?: string
          emisor_nit: string
          id?: number
          origen?: string
          product_id: number
          updated_at?: string
          veces_usado?: number
        }
        Update: {
          codigo_proveedor?: string
          confirmado_por?: string | null
          created_at?: string
          emisor_nit?: string
          id?: number
          origen?: string
          product_id?: number
          updated_at?: string
          veces_usado?: number
        }
        Relationships: [
          {
            foreignKeyName: "compra_producto_alias_confirmado_por_fkey"
            columns: ["confirmado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_producto_alias_confirmado_por_fkey"
            columns: ["confirmado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_producto_alias_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_producto_alias_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_renglon_pendiente: {
        Row: {
          codigo_proveedor: string | null
          created_at: string
          descripcion: string
          documentos: number
          emisor_nit: string
          id: number
          ignorado: boolean
          ignorado_motivo: string | null
          ignorado_por: string | null
          llave: string
          nombre_limpio: string | null
          renglones: number
          sugerido_origen: string | null
          sugerido_product_id: number | null
          sugerido_similitud: number | null
          ultima_fecha: string | null
          unidades: number
          updated_at: string
        }
        Insert: {
          codigo_proveedor?: string | null
          created_at?: string
          descripcion: string
          documentos?: number
          emisor_nit: string
          id?: number
          ignorado?: boolean
          ignorado_motivo?: string | null
          ignorado_por?: string | null
          llave: string
          nombre_limpio?: string | null
          renglones?: number
          sugerido_origen?: string | null
          sugerido_product_id?: number | null
          sugerido_similitud?: number | null
          ultima_fecha?: string | null
          unidades?: number
          updated_at?: string
        }
        Update: {
          codigo_proveedor?: string | null
          created_at?: string
          descripcion?: string
          documentos?: number
          emisor_nit?: string
          id?: number
          ignorado?: boolean
          ignorado_motivo?: string | null
          ignorado_por?: string | null
          llave?: string
          nombre_limpio?: string | null
          renglones?: number
          sugerido_origen?: string | null
          sugerido_product_id?: number | null
          sugerido_similitud?: number | null
          ultima_fecha?: string | null
          unidades?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compra_renglon_pendiente_ignorado_por_fkey"
            columns: ["ignorado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_renglon_pendiente_ignorado_por_fkey"
            columns: ["ignorado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_renglon_pendiente_sugerido_product_id_fkey"
            columns: ["sugerido_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_renglon_pendiente_sugerido_product_id_fkey"
            columns: ["sugerido_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      consentimientos_cliente: {
        Row: {
          created_at: string
          customer_id: number
          finalidad: string
          id: string
          identificado_por: string
          origen: string
          otorgado: boolean
          texto: string
          version_aviso: string | null
        }
        Insert: {
          created_at?: string
          customer_id: number
          finalidad: string
          id?: string
          identificado_por: string
          origen: string
          otorgado: boolean
          texto: string
          version_aviso?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: number
          finalidad?: string
          id?: string
          identificado_por?: string
          origen?: string
          otorgado?: boolean
          texto?: string
          version_aviso?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consentimientos_cliente_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consentimientos_cliente_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      contabilidad_config: {
        Row: {
          created_at: string
          id: number
          periodo_inicial: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          periodo_inicial: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          periodo_inicial?: string
          updated_at?: string
        }
        Relationships: []
      }
      conteo_inventario_costos: {
        Row: {
          costo_unitario: number | null
          created_at: string
          item_id: string
        }
        Insert: {
          costo_unitario?: number | null
          created_at?: string
          item_id: string
        }
        Update: {
          costo_unitario?: number | null
          created_at?: string
          item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conteo_inventario_costos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: true
            referencedRelation: "conteo_inventario_items"
            referencedColumns: ["id"]
          },
        ]
      }
      conteo_inventario_item_history: {
        Row: {
          contado_at: string
          contado_por: string | null
          diferencia: number | null
          estado_item: string | null
          evento: string
          fisico_cantidad: number | null
          id: string
          item_id: string
          nota: string | null
          sistema_cantidad: number | null
        }
        Insert: {
          contado_at?: string
          contado_por?: string | null
          diferencia?: number | null
          estado_item?: string | null
          evento?: string
          fisico_cantidad?: number | null
          id?: string
          item_id: string
          nota?: string | null
          sistema_cantidad?: number | null
        }
        Update: {
          contado_at?: string
          contado_por?: string | null
          diferencia?: number | null
          estado_item?: string | null
          evento?: string
          fisico_cantidad?: number | null
          id?: string
          item_id?: string
          nota?: string | null
          sistema_cantidad?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conteo_inventario_item_history_contado_por_fkey"
            columns: ["contado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteo_inventario_item_history_contado_por_fkey"
            columns: ["contado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteo_inventario_item_history_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "conteo_inventario_items"
            referencedColumns: ["id"]
          },
        ]
      }
      conteo_inventario_items: {
        Row: {
          contado_at: string | null
          contado_por: string | null
          conteo_id: string
          costo_unitario: number | null
          detalle: string | null
          diferencia: number | null
          erp_product_id: number
          es_agregado_manual: boolean
          estado_item: string
          fecha_vencimiento: string | null
          fisico_cantidad: number | null
          fisico_primer_conteo: number | null
          grupo_key: string | null
          id: string
          is_vencidos: boolean
          lote: string | null
          nota: string | null
          presentacion: string | null
          recontado_at: string | null
          recontado_por: string | null
          sistema_cantidad: number
          sistema_inicial: number | null
          source_inventory_id: number | null
          source_sync_key: string | null
        }
        Insert: {
          contado_at?: string | null
          contado_por?: string | null
          conteo_id: string
          costo_unitario?: number | null
          detalle?: string | null
          diferencia?: number | null
          erp_product_id: number
          es_agregado_manual?: boolean
          estado_item?: string
          fecha_vencimiento?: string | null
          fisico_cantidad?: number | null
          fisico_primer_conteo?: number | null
          grupo_key?: string | null
          id?: string
          is_vencidos?: boolean
          lote?: string | null
          nota?: string | null
          presentacion?: string | null
          recontado_at?: string | null
          recontado_por?: string | null
          sistema_cantidad: number
          sistema_inicial?: number | null
          source_inventory_id?: number | null
          source_sync_key?: string | null
        }
        Update: {
          contado_at?: string | null
          contado_por?: string | null
          conteo_id?: string
          costo_unitario?: number | null
          detalle?: string | null
          diferencia?: number | null
          erp_product_id?: number
          es_agregado_manual?: boolean
          estado_item?: string
          fecha_vencimiento?: string | null
          fisico_cantidad?: number | null
          fisico_primer_conteo?: number | null
          grupo_key?: string | null
          id?: string
          is_vencidos?: boolean
          lote?: string | null
          nota?: string | null
          presentacion?: string | null
          recontado_at?: string | null
          recontado_por?: string | null
          sistema_cantidad?: number
          sistema_inicial?: number | null
          source_inventory_id?: number | null
          source_sync_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conteo_inventario_items_contado_por_fkey"
            columns: ["contado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteo_inventario_items_contado_por_fkey"
            columns: ["contado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteo_inventario_items_conteo_id_fkey"
            columns: ["conteo_id"]
            isOneToOne: false
            referencedRelation: "conteos_inventario"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteo_items_recontado_por_fkey"
            columns: ["recontado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteo_items_recontado_por_fkey"
            columns: ["recontado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      conteos_inventario: {
        Row: {
          ajuste_erp_aplicado: boolean
          ajuste_erp_at: string | null
          ajuste_erp_nota: string | null
          ajuste_erp_por: string | null
          aprobado_at: string | null
          aprobado_por: string | null
          branch_id: number
          created_at: string
          created_by: string | null
          finalizado_at: string | null
          finalizado_por: string | null
          fuente_sistema: string
          id: string
          incluye_vencidos: boolean
          modo: string
          nota_aprobacion: string | null
          notas: string | null
          pendientes_como_cero: boolean | null
          scope_filter: Json | null
          scope_type: string
          status: string
          total_contados: number | null
          total_diferencias: number | null
          total_items: number | null
          total_pendientes: number | null
          total_recontados: number | null
          valor_faltante: number | null
          valor_sobrante: number | null
        }
        Insert: {
          ajuste_erp_aplicado?: boolean
          ajuste_erp_at?: string | null
          ajuste_erp_nota?: string | null
          ajuste_erp_por?: string | null
          aprobado_at?: string | null
          aprobado_por?: string | null
          branch_id: number
          created_at?: string
          created_by?: string | null
          finalizado_at?: string | null
          finalizado_por?: string | null
          fuente_sistema?: string
          id?: string
          incluye_vencidos?: boolean
          modo?: string
          nota_aprobacion?: string | null
          notas?: string | null
          pendientes_como_cero?: boolean | null
          scope_filter?: Json | null
          scope_type: string
          status?: string
          total_contados?: number | null
          total_diferencias?: number | null
          total_items?: number | null
          total_pendientes?: number | null
          total_recontados?: number | null
          valor_faltante?: number | null
          valor_sobrante?: number | null
        }
        Update: {
          ajuste_erp_aplicado?: boolean
          ajuste_erp_at?: string | null
          ajuste_erp_nota?: string | null
          ajuste_erp_por?: string | null
          aprobado_at?: string | null
          aprobado_por?: string | null
          branch_id?: number
          created_at?: string
          created_by?: string | null
          finalizado_at?: string | null
          finalizado_por?: string | null
          fuente_sistema?: string
          id?: string
          incluye_vencidos?: boolean
          modo?: string
          nota_aprobacion?: string | null
          notas?: string | null
          pendientes_como_cero?: boolean | null
          scope_filter?: Json | null
          scope_type?: string
          status?: string
          total_contados?: number | null
          total_diferencias?: number | null
          total_items?: number | null
          total_pendientes?: number | null
          total_recontados?: number | null
          valor_faltante?: number | null
          valor_sobrante?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "conteos_inventario_ajuste_erp_por_fkey"
            columns: ["ajuste_erp_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_ajuste_erp_por_fkey"
            columns: ["ajuste_erp_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_aprobado_por_fkey"
            columns: ["aprobado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_finalizado_por_fkey"
            columns: ["finalizado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conteos_inventario_finalizado_por_fkey"
            columns: ["finalizado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      corte_z: {
        Row: {
          branch_id: number
          ccf_total: number
          created_at: string
          detalle: Json
          factura_total: number
          fecha_fin: string
          fecha_inicio: string
          id: number
          obtenido_at: string
          periodo: string
          ticket: string
          tiquete_total: number
          total_general: number
          updated_at: string
        }
        Insert: {
          branch_id: number
          ccf_total?: number
          created_at?: string
          detalle?: Json
          factura_total?: number
          fecha_fin: string
          fecha_inicio: string
          id?: number
          obtenido_at?: string
          periodo: string
          ticket: string
          tiquete_total?: number
          total_general: number
          updated_at?: string
        }
        Update: {
          branch_id?: number
          ccf_total?: number
          created_at?: string
          detalle?: Json
          factura_total?: number
          fecha_fin?: string
          fecha_inicio?: string
          id?: number
          obtenido_at?: string
          periodo?: string
          ticket?: string
          tiquete_total?: number
          total_general?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corte_z_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja: {
        Row: {
          branch_id: number
          caja_erp: number | null
          capturado_at: string
          cobros_portal_efectivo: number
          created_at: string
          desfase_seg: number | null
          diferencia_erp: number
          empleado_texto: string | null
          employee_id: string | null
          entrega: string | null
          erp_corte_id: number
          esperado: number | null
          estado: string
          fecha: string
          hora: string
          id: number
          motivo_descarte: string | null
          observaciones: string | null
          pdf_doc_ccf: number | null
          pdf_doc_factura: number | null
          pdf_doc_tiquete: number | null
          pdf_doc_total: number | null
          pdf_texto: string | null
          recibido_at: string | null
          recibido_por: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          sin_entrega_motivo: string | null
          ticket: string | null
          tipo: string
          tk_cobros_credito: number | null
          tk_credito: number | null
          tk_devoluciones: number | null
          tk_efectivo: number | null
          tk_ingresos: number | null
          tk_retencion: number | null
          tk_saldo_caja_chica: number | null
          tk_saldo_inicial: number | null
          tk_subtotal: number | null
          tk_tarjeta: number | null
          tk_total_caja: number | null
          tk_vales: number | null
          tk_venta: number | null
          total_declarado: number
          turno: number | null
          updated_at: string
        }
        Insert: {
          branch_id: number
          caja_erp?: number | null
          capturado_at?: string
          cobros_portal_efectivo?: number
          created_at?: string
          desfase_seg?: number | null
          diferencia_erp: number
          empleado_texto?: string | null
          employee_id?: string | null
          entrega?: string | null
          erp_corte_id: number
          esperado?: number | null
          estado?: string
          fecha: string
          hora: string
          id?: never
          motivo_descarte?: string | null
          observaciones?: string | null
          pdf_doc_ccf?: number | null
          pdf_doc_factura?: number | null
          pdf_doc_tiquete?: number | null
          pdf_doc_total?: number | null
          pdf_texto?: string | null
          recibido_at?: string | null
          recibido_por?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          sin_entrega_motivo?: string | null
          ticket?: string | null
          tipo: string
          tk_cobros_credito?: number | null
          tk_credito?: number | null
          tk_devoluciones?: number | null
          tk_efectivo?: number | null
          tk_ingresos?: number | null
          tk_retencion?: number | null
          tk_saldo_caja_chica?: number | null
          tk_saldo_inicial?: number | null
          tk_subtotal?: number | null
          tk_tarjeta?: number | null
          tk_total_caja?: number | null
          tk_vales?: number | null
          tk_venta?: number | null
          total_declarado: number
          turno?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: number
          caja_erp?: number | null
          capturado_at?: string
          cobros_portal_efectivo?: number
          created_at?: string
          desfase_seg?: number | null
          diferencia_erp?: number
          empleado_texto?: string | null
          employee_id?: string | null
          entrega?: string | null
          erp_corte_id?: number
          esperado?: number | null
          estado?: string
          fecha?: string
          hora?: string
          id?: never
          motivo_descarte?: string | null
          observaciones?: string | null
          pdf_doc_ccf?: number | null
          pdf_doc_factura?: number | null
          pdf_doc_tiquete?: number | null
          pdf_doc_total?: number | null
          pdf_texto?: string | null
          recibido_at?: string | null
          recibido_por?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          sin_entrega_motivo?: string | null
          ticket?: string | null
          tipo?: string
          tk_cobros_credito?: number | null
          tk_credito?: number | null
          tk_devoluciones?: number | null
          tk_efectivo?: number | null
          tk_ingresos?: number | null
          tk_retencion?: number | null
          tk_saldo_caja_chica?: number | null
          tk_saldo_inicial?: number | null
          tk_subtotal?: number | null
          tk_tarjeta?: number | null
          tk_total_caja?: number | null
          tk_vales?: number | null
          tk_venta?: number | null
          total_declarado?: number
          turno?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_resuelto_por_fkey"
            columns: ["resuelto_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_resuelto_por_fkey"
            columns: ["resuelto_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_aperturas: {
        Row: {
          abierta_a: string | null
          abierta_el: string
          branch_id: number
          caja_erp: number | null
          cerrada_at: string | null
          created_at: string
          empleado_texto: string | null
          employee_id: string | null
          erp_apertura_id: number
          erp_empleado_id: number | null
          id: number
          monto_apertura: number | null
          monto_registrado: number | null
          turno: number | null
          turno_corriendo: boolean | null
          updated_at: string
          vista_at: string
        }
        Insert: {
          abierta_a?: string | null
          abierta_el: string
          branch_id: number
          caja_erp?: number | null
          cerrada_at?: string | null
          created_at?: string
          empleado_texto?: string | null
          employee_id?: string | null
          erp_apertura_id: number
          erp_empleado_id?: number | null
          id?: never
          monto_apertura?: number | null
          monto_registrado?: number | null
          turno?: number | null
          turno_corriendo?: boolean | null
          updated_at?: string
          vista_at?: string
        }
        Update: {
          abierta_a?: string | null
          abierta_el?: string
          branch_id?: number
          caja_erp?: number | null
          cerrada_at?: string | null
          created_at?: string
          empleado_texto?: string | null
          employee_id?: string | null
          erp_apertura_id?: number
          erp_empleado_id?: number | null
          id?: never
          monto_apertura?: number | null
          monto_registrado?: number | null
          turno?: number | null
          turno_corriendo?: boolean | null
          updated_at?: string
          vista_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_aperturas_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_aperturas_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_aperturas_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_diferencia_abonos: {
        Row: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          created_at: string
          diferencia_id: number
          employee_id: string
          id: number
          impreso_at: string | null
          monto: number
          movimiento_id: number | null
          persona_id: number
          registrado_at: string
          registrado_por: string | null
        }
        Insert: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          asentado_at?: string | null
          asentado_por?: string | null
          asentado_ref?: string | null
          branch_id: number
          created_at?: string
          diferencia_id: number
          employee_id: string
          id?: never
          impreso_at?: string | null
          monto: number
          movimiento_id?: number | null
          persona_id: number
          registrado_at?: string
          registrado_por?: string | null
        }
        Update: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          asentado_at?: string | null
          asentado_por?: string | null
          asentado_ref?: string | null
          branch_id?: number
          created_at?: string
          diferencia_id?: number
          employee_id?: string
          id?: never
          impreso_at?: string | null
          monto?: number
          movimiento_id?: number | null
          persona_id?: number
          registrado_at?: string
          registrado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_asentado_por_fkey"
            columns: ["asentado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_asentado_por_fkey"
            columns: ["asentado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_diferencia_id_fkey"
            columns: ["diferencia_id"]
            isOneToOne: false
            referencedRelation: "cortes_caja_diferencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "caja_movimientos_portal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "cortes_caja_diferencia_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_abonos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_diferencia_personas: {
        Row: {
          created_at: string
          del_turno: boolean
          diferencia_id: number
          employee_id: string
          id: number
          monto: number
        }
        Insert: {
          created_at?: string
          del_turno?: boolean
          diferencia_id: number
          employee_id: string
          id?: number
          monto: number
        }
        Update: {
          created_at?: string
          del_turno?: boolean
          diferencia_id?: number
          employee_id?: string
          id?: number
          monto?: number
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_diferencia_personas_diferencia_id_fkey"
            columns: ["diferencia_id"]
            isOneToOne: false
            referencedRelation: "cortes_caja_diferencias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_personas_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencia_personas_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_diferencias: {
        Row: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          causa: string
          corte_id: number
          created_at: string
          evidencia_foto_url: string | null
          evidencia_ref: string | null
          fecha: string
          id: number
          impreso_at: string | null
          monto: number
          registrado_at: string
          registrado_por: string | null
          updated_at: string
          via: string
        }
        Insert: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          asentado_at?: string | null
          asentado_por?: string | null
          asentado_ref?: string | null
          branch_id: number
          causa: string
          corte_id: number
          created_at?: string
          evidencia_foto_url?: string | null
          evidencia_ref?: string | null
          fecha: string
          id?: number
          impreso_at?: string | null
          monto: number
          registrado_at?: string
          registrado_por?: string | null
          updated_at?: string
          via: string
        }
        Update: {
          anulada_at?: string | null
          anulada_motivo?: string | null
          anulada_por?: string | null
          asentado_at?: string | null
          asentado_por?: string | null
          asentado_ref?: string | null
          branch_id?: number
          causa?: string
          corte_id?: number
          created_at?: string
          evidencia_foto_url?: string | null
          evidencia_ref?: string | null
          fecha?: string
          id?: number
          impreso_at?: string | null
          monto?: number
          registrado_at?: string
          registrado_por?: string | null
          updated_at?: string
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_diferencias_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencias_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencias_asentado_por_fkey"
            columns: ["asentado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencias_asentado_por_fkey"
            columns: ["asentado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencias_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencias_corte_id_fkey"
            columns: ["corte_id"]
            isOneToOne: false
            referencedRelation: "cortes_caja"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencias_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_diferencias_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_eventos: {
        Row: {
          accion: string
          corte_id: number
          created_at: string
          employee_id: string | null
          estado_antes: string | null
          estado_despues: string | null
          id: number
          motivo: string | null
          nota: string | null
          origen: string | null
        }
        Insert: {
          accion: string
          corte_id: number
          created_at?: string
          employee_id?: string | null
          estado_antes?: string | null
          estado_despues?: string | null
          id?: number
          motivo?: string | null
          nota?: string | null
          origen?: string | null
        }
        Update: {
          accion?: string
          corte_id?: number
          created_at?: string
          employee_id?: string | null
          estado_antes?: string | null
          estado_despues?: string | null
          id?: number
          motivo?: string | null
          nota?: string | null
          origen?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_eventos_corte_id_fkey"
            columns: ["corte_id"]
            isOneToOne: false
            referencedRelation: "cortes_caja"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_eventos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_eventos_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_movimientos: {
        Row: {
          branch_id: number
          capturado_at: string
          concepto: string | null
          created_at: string
          desaparecido_at: string | null
          erp_movimiento_id: number
          fecha: string
          id: number
          monto: number
          origen: string
          tipo: string
          updated_at: string
          visto_at: string
        }
        Insert: {
          branch_id: number
          capturado_at?: string
          concepto?: string | null
          created_at?: string
          desaparecido_at?: string | null
          erp_movimiento_id: number
          fecha: string
          id?: never
          monto: number
          origen?: string
          tipo: string
          updated_at?: string
          visto_at?: string
        }
        Update: {
          branch_id?: number
          capturado_at?: string
          concepto?: string | null
          created_at?: string
          desaparecido_at?: string | null
          erp_movimiento_id?: number
          fecha?: string
          id?: never
          monto?: number
          origen?: string
          tipo?: string
          updated_at?: string
          visto_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_movimientos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_movimientos_historial: {
        Row: {
          branch_id: number
          cambio: string
          concepto_antes: string | null
          concepto_despues: string | null
          corte_id: number | null
          created_at: string
          erp_movimiento_id: number
          fecha: string | null
          id: number
          monto_antes: number | null
          monto_despues: number | null
          observado_at: string
          tipo_antes: string | null
          tipo_despues: string | null
        }
        Insert: {
          branch_id: number
          cambio: string
          concepto_antes?: string | null
          concepto_despues?: string | null
          corte_id?: number | null
          created_at?: string
          erp_movimiento_id: number
          fecha?: string | null
          id?: never
          monto_antes?: number | null
          monto_despues?: number | null
          observado_at?: string
          tipo_antes?: string | null
          tipo_despues?: string | null
        }
        Update: {
          branch_id?: number
          cambio?: string
          concepto_antes?: string | null
          concepto_despues?: string | null
          corte_id?: number | null
          created_at?: string
          erp_movimiento_id?: number
          fecha?: string | null
          id?: never
          monto_antes?: number | null
          monto_despues?: number | null
          observado_at?: string
          tipo_antes?: string | null
          tipo_despues?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_movimientos_historial_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cortes_caja_movimientos_historial_corte_id_fkey"
            columns: ["corte_id"]
            isOneToOne: false
            referencedRelation: "cortes_caja"
            referencedColumns: ["id"]
          },
        ]
      }
      cortes_caja_vistazos: {
        Row: {
          branch_id: number
          created_at: string
          encontrados: number
          mirado_el: string
        }
        Insert: {
          branch_id: number
          created_at?: string
          encontrados?: number
          mirado_el?: string
        }
        Update: {
          branch_id?: number
          created_at?: string
          encontrados?: number
          mirado_el?: string
        }
        Relationships: [
          {
            foreignKeyName: "cortes_caja_vistazos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizacion_items: {
        Row: {
          cantidad: number
          cotizacion_id: number
          id: number
          precio_unitario: number
          presentacion_desc: string | null
          presentacion_id: number | null
          price_type: string
          product_id: number | null
          product_nombre: string
          sort_order: number | null
          subtotal: number
        }
        Insert: {
          cantidad?: number
          cotizacion_id: number
          id?: number
          precio_unitario?: number
          presentacion_desc?: string | null
          presentacion_id?: number | null
          price_type?: string
          product_id?: number | null
          product_nombre: string
          sort_order?: number | null
          subtotal?: number
        }
        Update: {
          cantidad?: number
          cotizacion_id?: number
          id?: number
          precio_unitario?: number
          presentacion_desc?: string | null
          presentacion_id?: number | null
          price_type?: string
          product_id?: number | null
          product_nombre?: string
          sort_order?: number | null
          subtotal?: number
        }
        Relationships: [
          {
            foreignKeyName: "cotizacion_items_cotizacion_id_fkey"
            columns: ["cotizacion_id"]
            isOneToOne: false
            referencedRelation: "cotizaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_presentacion"
            columns: ["presentacion_id"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ci_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      cotizaciones: {
        Row: {
          applies_retention: boolean
          branch_id: number | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          created_by_photo: string | null
          customer_id: number | null
          customer_name: string
          customer_nit: string | null
          document_type: string
          fecha: string
          id: number
          iva_amount: number
          notes: string | null
          numero: string
          payment_type: string
          retention_amount: number
          status: string
          subtotal_gravado: number
          total: number
          updated_at: string | null
        }
        Insert: {
          applies_retention?: boolean
          branch_id?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          created_by_photo?: string | null
          customer_id?: number | null
          customer_name?: string
          customer_nit?: string | null
          document_type?: string
          fecha?: string
          id?: number
          iva_amount?: number
          notes?: string | null
          numero: string
          payment_type?: string
          retention_amount?: number
          status?: string
          subtotal_gravado?: number
          total?: number
          updated_at?: string | null
        }
        Update: {
          applies_retention?: boolean
          branch_id?: number | null
          created_at?: string | null
          created_by?: string | null
          created_by_name?: string | null
          created_by_photo?: string | null
          customer_id?: number | null
          customer_name?: string
          customer_nit?: string | null
          document_type?: string
          fecha?: string
          id?: number
          iva_amount?: number
          notes?: string | null
          numero?: string
          payment_type?: string
          retention_amount?: number
          status?: string
          subtotal_gravado?: number
          total?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cotizaciones_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cotizaciones_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "fk_cot_created_by"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cot_created_by"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      creditos_abonos_portal: {
        Row: {
          abonado_por: string
          anulado_at: string | null
          anulado_por: string | null
          branch_id: number
          cliente: string
          comprobante_url: string | null
          created_at: string
          credito_erp: string
          documento: string | null
          erp_abono_id: string | null
          factura_erp: string | null
          fecha_documento: string | null
          forma: string
          id: number
          lectura: Json | null
          monto: number
          pago_id: number | null
          pos_proveedor: string | null
          saldo_antes: number | null
          saldo_despues: number | null
        }
        Insert: {
          abonado_por: string
          anulado_at?: string | null
          anulado_por?: string | null
          branch_id: number
          cliente: string
          comprobante_url?: string | null
          created_at?: string
          credito_erp: string
          documento?: string | null
          erp_abono_id?: string | null
          factura_erp?: string | null
          fecha_documento?: string | null
          forma: string
          id?: never
          lectura?: Json | null
          monto: number
          pago_id?: number | null
          pos_proveedor?: string | null
          saldo_antes?: number | null
          saldo_despues?: number | null
        }
        Update: {
          abonado_por?: string
          anulado_at?: string | null
          anulado_por?: string | null
          branch_id?: number
          cliente?: string
          comprobante_url?: string | null
          created_at?: string
          credito_erp?: string
          documento?: string | null
          erp_abono_id?: string | null
          factura_erp?: string | null
          fecha_documento?: string | null
          forma?: string
          id?: never
          lectura?: Json | null
          monto?: number
          pago_id?: number | null
          pos_proveedor?: string | null
          saldo_antes?: number | null
          saldo_despues?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "creditos_abonos_portal_abonado_por_fkey"
            columns: ["abonado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_abonos_portal_abonado_por_fkey"
            columns: ["abonado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_abonos_portal_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_abonos_portal_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_abonos_portal_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_abonos_portal_pago_id_fkey"
            columns: ["pago_id"]
            isOneToOne: false
            referencedRelation: "creditos_pagos"
            referencedColumns: ["id"]
          },
        ]
      }
      creditos_cobros_por_aprobar: {
        Row: {
          branch_id: number
          cliente: string | null
          created_at: string
          credito_erp: string
          id: number
          monto: number
          resuelto_at: string | null
          solicitud_id: string
        }
        Insert: {
          branch_id: number
          cliente?: string | null
          created_at?: string
          credito_erp: string
          id?: never
          monto: number
          resuelto_at?: string | null
          solicitud_id: string
        }
        Update: {
          branch_id?: number
          cliente?: string | null
          created_at?: string
          credito_erp?: string
          id?: never
          monto?: number
          resuelto_at?: string | null
          solicitud_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creditos_cobros_por_aprobar_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_cobros_por_aprobar_solicitud_id_fkey"
            columns: ["solicitud_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      creditos_de_clientes: {
        Row: {
          abonado: number
          anulado_el: string | null
          branch_id: number
          cliente: string
          created_at: string
          credito_erp: string
          customer_id: number | null
          estado: string | null
          factura_erp: string | null
          fecha: string
          id: number
          numero_doc: string | null
          pagado_el: string | null
          saldo: number
          tipo_doc: string | null
          total: number
          ultimo_abono_el: string | null
          updated_at: string
          vencio_el: string | null
          vendedor_code: string | null
          vendedor_id: string | null
        }
        Insert: {
          abonado?: number
          anulado_el?: string | null
          branch_id: number
          cliente: string
          created_at?: string
          credito_erp: string
          customer_id?: number | null
          estado?: string | null
          factura_erp?: string | null
          fecha: string
          id?: never
          numero_doc?: string | null
          pagado_el?: string | null
          saldo?: number
          tipo_doc?: string | null
          total?: number
          ultimo_abono_el?: string | null
          updated_at?: string
          vencio_el?: string | null
          vendedor_code?: string | null
          vendedor_id?: string | null
        }
        Update: {
          abonado?: number
          anulado_el?: string | null
          branch_id?: number
          cliente?: string
          created_at?: string
          credito_erp?: string
          customer_id?: number | null
          estado?: string | null
          factura_erp?: string | null
          fecha?: string
          id?: never
          numero_doc?: string | null
          pagado_el?: string | null
          saldo?: number
          tipo_doc?: string | null
          total?: number
          ultimo_abono_el?: string | null
          updated_at?: string
          vencio_el?: string | null
          vendedor_code?: string | null
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creditos_de_clientes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_de_clientes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_de_clientes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "creditos_de_clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_de_clientes_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      creditos_pagos: {
        Row: {
          branch_id: number
          cliente: string
          comprobante_url: string | null
          created_at: string
          customer_id: number | null
          documento: string | null
          fecha_documento: string | null
          forma: string
          id: number
          lectura: Json | null
          monto: number
          pos_proveedor: string | null
          registrado_por: string
        }
        Insert: {
          branch_id: number
          cliente: string
          comprobante_url?: string | null
          created_at?: string
          customer_id?: number | null
          documento?: string | null
          fecha_documento?: string | null
          forma: string
          id?: never
          lectura?: Json | null
          monto: number
          pos_proveedor?: string | null
          registrado_por: string
        }
        Update: {
          branch_id?: number
          cliente?: string
          comprobante_url?: string | null
          created_at?: string
          customer_id?: number | null
          documento?: string | null
          fecha_documento?: string | null
          forma?: string
          id?: never
          lectura?: Json | null
          monto?: number
          pos_proveedor?: string | null
          registrado_por?: string
        }
        Relationships: [
          {
            foreignKeyName: "creditos_pagos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_pagos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_pagos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "creditos_pagos_pos_proveedor_fkey"
            columns: ["pos_proveedor"]
            isOneToOne: false
            referencedRelation: "pos_proveedores"
            referencedColumns: ["codigo"]
          },
          {
            foreignKeyName: "creditos_pagos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creditos_pagos_registrado_por_fkey"
            columns: ["registrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      creditos_sync: {
        Row: {
          cambios: number
          corrio_el: string
          created_at: string
          error: string | null
          filas: number
          id: boolean
          ok: boolean
        }
        Insert: {
          cambios?: number
          corrio_el?: string
          created_at?: string
          error?: string | null
          filas?: number
          id?: boolean
          ok?: boolean
        }
        Update: {
          cambios?: number
          corrio_el?: string
          created_at?: string
          error?: string | null
          filas?: number
          id?: boolean
          ok?: boolean
        }
        Relationships: []
      }
      customer_activity: {
        Row: {
          created_at: string
          customer_id: number
          facturas: number
          facturas_anuladas: number
          facturas_ccf: number
          primera_fecha: string | null
          total: number
          ultima_fecha: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: number
          facturas?: number
          facturas_anuladas?: number
          facturas_ccf?: number
          primera_fecha?: string | null
          total?: number
          ultima_fecha?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: number
          facturas?: number
          facturas_anuladas?: number
          facturas_ccf?: number
          primera_fecha?: string | null
          total?: number
          ultima_fecha?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_activity_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_activity_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      customers: {
        Row: {
          acepta_programa_puntos: boolean | null
          acepta_promociones: boolean | null
          acumula_puntos: boolean
          categoria: string | null
          created_at: string | null
          departamento: string | null
          direccion: string | null
          distrito: string | null
          dui: string | null
          email: string | null
          erp_id: string | null
          fecha_nacimiento: string | null
          giro: string | null
          id: number
          ids_busq: string | null
          ids_comp: string | null
          municipio: string | null
          name: string
          nit: string | null
          nombre_busq: string | null
          nombre_comp: string | null
          notes: string | null
          nrc: string | null
          pasaporte: string | null
          phone: string | null
          retencion_pct: number | null
          search_name: string | null
          telefono2: string | null
          updated_at: string | null
        }
        Insert: {
          acepta_programa_puntos?: boolean | null
          acepta_promociones?: boolean | null
          acumula_puntos?: boolean
          categoria?: string | null
          created_at?: string | null
          departamento?: string | null
          direccion?: string | null
          distrito?: string | null
          dui?: string | null
          email?: string | null
          erp_id?: string | null
          fecha_nacimiento?: string | null
          giro?: string | null
          id?: never
          ids_busq?: string | null
          ids_comp?: string | null
          municipio?: string | null
          name: string
          nit?: string | null
          nombre_busq?: string | null
          nombre_comp?: string | null
          notes?: string | null
          nrc?: string | null
          pasaporte?: string | null
          phone?: string | null
          retencion_pct?: number | null
          search_name?: string | null
          telefono2?: string | null
          updated_at?: string | null
        }
        Update: {
          acepta_programa_puntos?: boolean | null
          acepta_promociones?: boolean | null
          acumula_puntos?: boolean
          categoria?: string | null
          created_at?: string | null
          departamento?: string | null
          direccion?: string | null
          distrito?: string | null
          dui?: string | null
          email?: string | null
          erp_id?: string | null
          fecha_nacimiento?: string | null
          giro?: string | null
          id?: never
          ids_busq?: string | null
          ids_comp?: string | null
          municipio?: string | null
          name?: string
          nit?: string | null
          nombre_busq?: string | null
          nombre_comp?: string | null
          notes?: string | null
          nrc?: string | null
          pasaporte?: string | null
          phone?: string | null
          retencion_pct?: number | null
          search_name?: string | null
          telefono2?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      customers_changelog: {
        Row: {
          campo: string
          changed_at: string
          changed_by: string | null
          changed_by_nombre: string | null
          created_at: string
          customer_id: number
          descartado_at: string | null
          erp_synced_at: string | null
          id: number
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Insert: {
          campo: string
          changed_at?: string
          changed_by?: string | null
          changed_by_nombre?: string | null
          created_at?: string
          customer_id: number
          descartado_at?: string | null
          erp_synced_at?: string | null
          id?: never
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          campo?: string
          changed_at?: string
          changed_by?: string | null
          changed_by_nombre?: string | null
          created_at?: string
          customer_id?: number
          descartado_at?: string | null
          erp_synced_at?: string | null
          id?: never
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_changelog_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_changelog_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      dashboard_canon: {
        Row: {
          created_at: string
          medidas: Json
          orden: Json
          tab_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          medidas?: Json
          orden?: Json
          tab_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          medidas?: Json
          orden?: Json
          tab_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_canon_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_canon_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      depositos_bancarios: {
        Row: {
          anulado_at: string | null
          anulado_motivo: string | null
          anulado_por: string | null
          aporte: number
          aporte_nota: string | null
          banco_id: number | null
          cerrado_at: string
          cerrado_por: string | null
          comprobante_url: string | null
          created_at: string
          destino: string
          entregado_a: string | null
          fecha: string
          folio: string
          id: number
          llevado_por: string | null
          monto_deposito: number
          monto_efectivo: number
          nota: string | null
          remanente: number
          remanente_entregado_por: string | null
          remanente_recibido_por: string | null
          total_contado: number
        }
        Insert: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          aporte?: number
          aporte_nota?: string | null
          banco_id?: number | null
          cerrado_at?: string
          cerrado_por?: string | null
          comprobante_url?: string | null
          created_at?: string
          destino?: string
          entregado_a?: string | null
          fecha: string
          folio: string
          id?: never
          llevado_por?: string | null
          monto_deposito: number
          monto_efectivo?: number
          nota?: string | null
          remanente: number
          remanente_entregado_por?: string | null
          remanente_recibido_por?: string | null
          total_contado: number
        }
        Update: {
          anulado_at?: string | null
          anulado_motivo?: string | null
          anulado_por?: string | null
          aporte?: number
          aporte_nota?: string | null
          banco_id?: number | null
          cerrado_at?: string
          cerrado_por?: string | null
          comprobante_url?: string | null
          created_at?: string
          destino?: string
          entregado_a?: string | null
          fecha?: string
          folio?: string
          id?: never
          llevado_por?: string | null
          monto_deposito?: number
          monto_efectivo?: number
          nota?: string | null
          remanente?: number
          remanente_entregado_por?: string | null
          remanente_recibido_por?: string | null
          total_contado?: number
        }
        Relationships: [
          {
            foreignKeyName: "depositos_bancarios_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_anulado_por_fkey"
            columns: ["anulado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_banco_id_fkey"
            columns: ["banco_id"]
            isOneToOne: false
            referencedRelation: "bancos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_entregado_a_fkey"
            columns: ["entregado_a"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_entregado_a_fkey"
            columns: ["entregado_a"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_llevado_por_fkey"
            columns: ["llevado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_llevado_por_fkey"
            columns: ["llevado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_remanente_entregado_por_fkey"
            columns: ["remanente_entregado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_remanente_entregado_por_fkey"
            columns: ["remanente_entregado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_remanente_recibido_por_fkey"
            columns: ["remanente_recibido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depositos_bancarios_remanente_recibido_por_fkey"
            columns: ["remanente_recibido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      diferencia_opcion: {
        Row: {
          ayuda: string | null
          ayuda_bodega: string | null
          ayuda_sala: string | null
          cierra_con: string
          created_at: string
          error_tipo: string
          mueve: string
          orden: number
          rotulo: string
          rotulo_corto: string
          valor: string
        }
        Insert: {
          ayuda?: string | null
          ayuda_bodega?: string | null
          ayuda_sala?: string | null
          cierra_con: string
          created_at?: string
          error_tipo: string
          mueve: string
          orden: number
          rotulo: string
          rotulo_corto: string
          valor: string
        }
        Update: {
          ayuda?: string | null
          ayuda_bodega?: string | null
          ayuda_sala?: string | null
          cierra_con?: string
          created_at?: string
          error_tipo?: string
          mueve?: string
          orden?: number
          rotulo?: string
          rotulo_corto?: string
          valor?: string
        }
        Relationships: []
      }
      dispatch_rules: {
        Row: {
          blister: number | null
          caja_especial: boolean
          created_at: string
          dispatch_id_presentacion: number | null
          dispatch_label: string | null
          dispatch_multiplo: number | null
          erp_product_id: number
          id: number
          multiplo: number | null
          multiplo_unidades: number | null
          notes: string | null
          solo_cajas: boolean
          updated_at: string
        }
        Insert: {
          blister?: number | null
          caja_especial?: boolean
          created_at?: string
          dispatch_id_presentacion?: number | null
          dispatch_label?: string | null
          dispatch_multiplo?: number | null
          erp_product_id: number
          id?: number
          multiplo?: number | null
          multiplo_unidades?: number | null
          notes?: string | null
          solo_cajas?: boolean
          updated_at?: string
        }
        Update: {
          blister?: number | null
          caja_especial?: boolean
          created_at?: string
          dispatch_id_presentacion?: number | null
          dispatch_label?: string | null
          dispatch_multiplo?: number | null
          erp_product_id?: number
          id?: number
          multiplo?: number | null
          multiplo_unidades?: number | null
          notes?: string | null
          solo_cajas?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispatch_rules_dispatch_id_presentacion_fkey"
            columns: ["dispatch_id_presentacion"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_rules_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispatch_rules_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: true
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      dispensacion_clases: {
        Row: {
          clase: string
          created_at: string
          definido_por: string | null
          erp_product_id: number
          motivo: string
          updated_at: string
        }
        Insert: {
          clase: string
          created_at?: string
          definido_por?: string | null
          erp_product_id: number
          motivo: string
          updated_at?: string
        }
        Update: {
          clase?: string
          created_at?: string
          definido_por?: string | null
          erp_product_id?: number
          motivo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dispensacion_clases_definido_por_fkey"
            columns: ["definido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensacion_clases_definido_por_fkey"
            columns: ["definido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensacion_clases_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dispensacion_clases_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: true
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_por_asignar: {
        Row: {
          aplicado_a: string | null
          aplicado_el: string | null
          creado_por: string | null
          created_at: string
          documento: Json
          id: string
          nombre_clave: string
          nombre_visible: string
        }
        Insert: {
          aplicado_a?: string | null
          aplicado_el?: string | null
          creado_por?: string | null
          created_at?: string
          documento: Json
          id?: string
          nombre_clave: string
          nombre_visible: string
        }
        Update: {
          aplicado_a?: string | null
          aplicado_el?: string | null
          creado_por?: string | null
          created_at?: string
          documento?: Json
          id?: string
          nombre_clave?: string
          nombre_visible?: string
        }
        Relationships: [
          {
            foreignKeyName: "documentos_por_asignar_aplicado_a_fkey"
            columns: ["aplicado_a"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_por_asignar_aplicado_a_fkey"
            columns: ["aplicado_a"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_por_asignar_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_por_asignar_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      dte_correcciones_ficha: {
        Row: {
          antes: string | null
          campo: string
          created_at: string
          customer_id: number | null
          despues: string | null
          erp_id: string
          id: number
          motivo: string
        }
        Insert: {
          antes?: string | null
          campo: string
          created_at?: string
          customer_id?: number | null
          despues?: string | null
          erp_id: string
          id?: number
          motivo: string
        }
        Update: {
          antes?: string | null
          campo?: string
          created_at?: string
          customer_id?: number | null
          despues?: string | null
          erp_id?: string
          id?: number
          motivo?: string
        }
        Relationships: []
      }
      dte_datos_pedidos: {
        Row: {
          aplicado_at: string | null
          branch_id: number
          campo: string
          correlativo: string | null
          created_at: string
          customer_id: number
          estado: string
          id: string
          invoice_id: number
          motivo_mh: string | null
          nota: string | null
          respondido_at: string | null
          respondido_por: string | null
          updated_at: string
          valor_actual: string | null
          valor_nuevo: string | null
        }
        Insert: {
          aplicado_at?: string | null
          branch_id: number
          campo?: string
          correlativo?: string | null
          created_at?: string
          customer_id: number
          estado?: string
          id?: string
          invoice_id: number
          motivo_mh?: string | null
          nota?: string | null
          respondido_at?: string | null
          respondido_por?: string | null
          updated_at?: string
          valor_actual?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          aplicado_at?: string | null
          branch_id?: number
          campo?: string
          correlativo?: string | null
          created_at?: string
          customer_id?: number
          estado?: string
          id?: string
          invoice_id?: number
          motivo_mh?: string | null
          nota?: string | null
          respondido_at?: string | null
          respondido_por?: string | null
          updated_at?: string
          valor_actual?: string | null
          valor_nuevo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dte_datos_pedidos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_datos_pedidos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_datos_pedidos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "dte_datos_pedidos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_datos_pedidos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_datos_pedidos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "dte_datos_pedidos_respondido_por_fkey"
            columns: ["respondido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_datos_pedidos_respondido_por_fkey"
            columns: ["respondido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      dte_excluidas_del_barrido: {
        Row: {
          created_at: string
          excluida_por: string | null
          invoice_id: number
          motivo: string
        }
        Insert: {
          created_at?: string
          excluida_por?: string | null
          invoice_id: number
          motivo: string
        }
        Update: {
          created_at?: string
          excluida_por?: string | null
          invoice_id?: number
          motivo?: string
        }
        Relationships: [
          {
            foreignKeyName: "dte_excluidas_del_barrido_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_excluidas_del_barrido_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_excluidas_del_barrido_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      dte_mh_intentos: {
        Row: {
          bolsa: string
          branch_id: number | null
          codigo_msg: string | null
          correccion: Json | null
          correlativo: string | null
          created_at: string
          descripcion_msg: string | null
          erp_invoice_id: string | null
          error: string | null
          fh_procesamiento: string | null
          id: number
          invoice_id: number
          observaciones: string[]
          ok: boolean
          sello: string | null
        }
        Insert: {
          bolsa: string
          branch_id?: number | null
          codigo_msg?: string | null
          correccion?: Json | null
          correlativo?: string | null
          created_at?: string
          descripcion_msg?: string | null
          erp_invoice_id?: string | null
          error?: string | null
          fh_procesamiento?: string | null
          id?: number
          invoice_id: number
          observaciones?: string[]
          ok: boolean
          sello?: string | null
        }
        Update: {
          bolsa?: string
          branch_id?: number | null
          codigo_msg?: string | null
          correccion?: Json | null
          correlativo?: string | null
          created_at?: string
          descripcion_msg?: string | null
          erp_invoice_id?: string | null
          error?: string | null
          fh_procesamiento?: string | null
          id?: number
          invoice_id?: number
          observaciones?: string[]
          ok?: boolean
          sello?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dte_mh_intentos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_mh_intentos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_mh_intentos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      dte_rechazos_avisados: {
        Row: {
          created_at: string
          destinatarios: number
          invoice_id: number
        }
        Insert: {
          created_at?: string
          destinatarios?: number
          invoice_id: number
        }
        Update: {
          created_at?: string
          destinatarios?: number
          invoice_id?: number
        }
        Relationships: []
      }
      education_catalog_entries: {
        Row: {
          category: string
          created_at: string
          id: number
          value: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: never
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: never
          value?: string
        }
        Relationships: []
      }
      email_sync_accounts: {
        Row: {
          active: boolean
          client_id_secret_name: string | null
          client_secret_secret_name: string | null
          created_at: string
          email: string
          id: number
          last_synced_date: string | null
          provider: string
          vault_secret_name: string
        }
        Insert: {
          active?: boolean
          client_id_secret_name?: string | null
          client_secret_secret_name?: string | null
          created_at?: string
          email: string
          id?: never
          last_synced_date?: string | null
          provider?: string
          vault_secret_name: string
        }
        Update: {
          active?: boolean
          client_id_secret_name?: string | null
          client_secret_secret_name?: string | null
          created_at?: string
          email?: string
          id?: never
          last_synced_date?: string | null
          provider?: string
          vault_secret_name?: string
        }
        Relationships: []
      }
      email_sync_log: {
        Row: {
          account_id: number | null
          checked_at: string
          created_at: string
          documents_inserted: number | null
          documents_skipped: number | null
          error_msg: string | null
          id: number
          messages_scanned: number | null
          pdfs_unmatched: number | null
          source: string | null
          success: boolean
        }
        Insert: {
          account_id?: number | null
          checked_at?: string
          created_at?: string
          documents_inserted?: number | null
          documents_skipped?: number | null
          error_msg?: string | null
          id?: never
          messages_scanned?: number | null
          pdfs_unmatched?: number | null
          source?: string | null
          success: boolean
        }
        Update: {
          account_id?: number | null
          checked_at?: string
          created_at?: string
          documents_inserted?: number | null
          documents_skipped?: number | null
          error_msg?: string | null
          id?: never
          messages_scanned?: number | null
          pdfs_unmatched?: number | null
          source?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_sync_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_auth_accounts: {
        Row: {
          auth_user_id: string
          created_at: string
          employee_id: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          employee_id: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_auth_accounts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_auth_accounts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_branches: {
        Row: {
          branch_id: number
          created_at: string
          employee_id: string
          id: number
        }
        Insert: {
          branch_id: number
          created_at?: string
          employee_id: string
          id?: never
        }
        Update: {
          branch_id?: number
          created_at?: string
          employee_id?: string
          id?: never
        }
        Relationships: [
          {
            foreignKeyName: "employee_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_branches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_branches_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_documents: {
        Row: {
          created_at: string
          employee_id: string | null
          event_id: string | null
          id: string
          name: string
          type: string | null
          url: string
        }
        Insert: {
          created_at?: string
          employee_id?: string | null
          event_id?: string | null
          id?: string
          name: string
          type?: string | null
          url: string
        }
        Update: {
          created_at?: string
          employee_id?: string | null
          event_id?: string | null
          id?: string
          name?: string
          type?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_documents_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "employee_events"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_events: {
        Row: {
          created_at: string
          date: string
          employee_id: string | null
          id: string
          metadata: Json | null
          note: string | null
          type: string
        }
        Insert: {
          created_at?: string
          date: string
          employee_id?: string | null
          id?: string
          metadata?: Json | null
          note?: string | null
          type: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string | null
          id?: string
          metadata?: Json | null
          note?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_events_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_rosters: {
        Row: {
          created_at: string | null
          employee_id: string
          id: number
          schedule_data: Json
          status: string
          updated_at: string | null
          week_start_date: string
        }
        Insert: {
          created_at?: string | null
          employee_id: string
          id?: number
          schedule_data?: Json
          status?: string
          updated_at?: string | null
          week_start_date: string
        }
        Update: {
          created_at?: string | null
          employee_id?: string
          id?: number
          schedule_data?: Json
          status?: string
          updated_at?: string | null
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_rosters_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_rosters_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          account_number: string | null
          account_type: string | null
          acreditaciones: Json
          additional_skills: Json
          address: string | null
          afp_estado: string | null
          afp_institution: string | null
          afp_number: string | null
          alt_identity_document: string | null
          alt_identity_document_type: string | null
          bank_name: string | null
          base_salary: number | null
          birth_date: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          blocked_until: string | null
          blood_type: string | null
          branch_id: number | null
          carne_dependiente_url: string | null
          carne_pendiente: boolean
          chronic_conditions: Json
          code: string
          contador_license_number: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          contract_temporal_legal_basis: string | null
          contract_temporal_reason: string | null
          contract_type: string | null
          contrato_fecha_celebracion: string | null
          contrato_lugar_celebracion: string | null
          contrato_prorrogas: Json
          created_at: string
          department: string | null
          disability_grade: string | null
          disability_has_certification: boolean
          disability_type: string | null
          distrito: string | null
          dui: string | null
          dui_fecha_expedicion: string | null
          dui_fecha_vencimiento: string | null
          dui_lugar_expedicion: string | null
          economic_dependents: Json
          education_grade_completed: string | null
          education_level: string | null
          education_specialty: string | null
          email: string | null
          emergency_contact_extra_phones: string[]
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          emergency_contacts: Json
          employee_documents: Json | null
          exceptions: Json | null
          extra_addresses: Json
          extra_emails: string[]
          extra_phones: string[]
          first_names: string
          forma_estipulacion_salario: string | null
          gender: string | null
          has_car: boolean
          has_car_license: boolean
          has_disability: boolean
          has_maestria: boolean
          has_motorcycle: boolean
          has_motorcycle_license: boolean
          has_srs_accreditation: boolean
          herramientas_entregadas: Json
          hire_date: string | null
          hours_owed: number | null
          id: string
          is_studying: boolean
          isss_estado: string | null
          isss_number: string | null
          kiosk_pin: string | null
          last_names: string
          lugar_nacimiento: string | null
          lugar_pago: string | null
          maestria_is_studying: boolean
          maestria_study_duration_years: number | null
          maestria_study_start_date: string | null
          maestria_title: string | null
          marital_status: string | null
          medico_license_number: string | null
          medio_pago: string | null
          mtps_remitido_fecha: string | null
          municipality: string | null
          name: string | null
          nationality: string | null
          nursing_license_number: string | null
          periodo_pago: string | null
          pharmacist_license_number: string | null
          phone: string | null
          photo_url: string | null
          profession: string | null
          role_id: number | null
          secondary_role_id: number | null
          shift_id: number | null
          srs_accreditation_expiry: string | null
          status: string | null
          study_duration_years: number | null
          study_start_date: string | null
          suplente_id: string | null
          tiene_acreditacion_dependiente: boolean
          tipo_ficha: string
          username: string | null
          weekly_contracted_hours: number | null
          weekly_schedule: Json | null
        }
        Insert: {
          account_number?: string | null
          account_type?: string | null
          acreditaciones?: Json
          additional_skills?: Json
          address?: string | null
          afp_estado?: string | null
          afp_institution?: string | null
          afp_number?: string | null
          alt_identity_document?: string | null
          alt_identity_document_type?: string | null
          bank_name?: string | null
          base_salary?: number | null
          birth_date?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          blood_type?: string | null
          branch_id?: number | null
          carne_dependiente_url?: string | null
          carne_pendiente?: boolean
          chronic_conditions?: Json
          code: string
          contador_license_number?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_temporal_legal_basis?: string | null
          contract_temporal_reason?: string | null
          contract_type?: string | null
          contrato_fecha_celebracion?: string | null
          contrato_lugar_celebracion?: string | null
          contrato_prorrogas?: Json
          created_at?: string
          department?: string | null
          disability_grade?: string | null
          disability_has_certification?: boolean
          disability_type?: string | null
          distrito?: string | null
          dui?: string | null
          dui_fecha_expedicion?: string | null
          dui_fecha_vencimiento?: string | null
          dui_lugar_expedicion?: string | null
          economic_dependents?: Json
          education_grade_completed?: string | null
          education_level?: string | null
          education_specialty?: string | null
          email?: string | null
          emergency_contact_extra_phones?: string[]
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          emergency_contacts?: Json
          employee_documents?: Json | null
          exceptions?: Json | null
          extra_addresses?: Json
          extra_emails?: string[]
          extra_phones?: string[]
          first_names: string
          forma_estipulacion_salario?: string | null
          gender?: string | null
          has_car?: boolean
          has_car_license?: boolean
          has_disability?: boolean
          has_maestria?: boolean
          has_motorcycle?: boolean
          has_motorcycle_license?: boolean
          has_srs_accreditation?: boolean
          herramientas_entregadas?: Json
          hire_date?: string | null
          hours_owed?: number | null
          id?: string
          is_studying?: boolean
          isss_estado?: string | null
          isss_number?: string | null
          kiosk_pin?: string | null
          last_names: string
          lugar_nacimiento?: string | null
          lugar_pago?: string | null
          maestria_is_studying?: boolean
          maestria_study_duration_years?: number | null
          maestria_study_start_date?: string | null
          maestria_title?: string | null
          marital_status?: string | null
          medico_license_number?: string | null
          medio_pago?: string | null
          mtps_remitido_fecha?: string | null
          municipality?: string | null
          name?: string | null
          nationality?: string | null
          nursing_license_number?: string | null
          periodo_pago?: string | null
          pharmacist_license_number?: string | null
          phone?: string | null
          photo_url?: string | null
          profession?: string | null
          role_id?: number | null
          secondary_role_id?: number | null
          shift_id?: number | null
          srs_accreditation_expiry?: string | null
          status?: string | null
          study_duration_years?: number | null
          study_start_date?: string | null
          suplente_id?: string | null
          tiene_acreditacion_dependiente?: boolean
          tipo_ficha?: string
          username?: string | null
          weekly_contracted_hours?: number | null
          weekly_schedule?: Json | null
        }
        Update: {
          account_number?: string | null
          account_type?: string | null
          acreditaciones?: Json
          additional_skills?: Json
          address?: string | null
          afp_estado?: string | null
          afp_institution?: string | null
          afp_number?: string | null
          alt_identity_document?: string | null
          alt_identity_document_type?: string | null
          bank_name?: string | null
          base_salary?: number | null
          birth_date?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          blood_type?: string | null
          branch_id?: number | null
          carne_dependiente_url?: string | null
          carne_pendiente?: boolean
          chronic_conditions?: Json
          code?: string
          contador_license_number?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_temporal_legal_basis?: string | null
          contract_temporal_reason?: string | null
          contract_type?: string | null
          contrato_fecha_celebracion?: string | null
          contrato_lugar_celebracion?: string | null
          contrato_prorrogas?: Json
          created_at?: string
          department?: string | null
          disability_grade?: string | null
          disability_has_certification?: boolean
          disability_type?: string | null
          distrito?: string | null
          dui?: string | null
          dui_fecha_expedicion?: string | null
          dui_fecha_vencimiento?: string | null
          dui_lugar_expedicion?: string | null
          economic_dependents?: Json
          education_grade_completed?: string | null
          education_level?: string | null
          education_specialty?: string | null
          email?: string | null
          emergency_contact_extra_phones?: string[]
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          emergency_contacts?: Json
          employee_documents?: Json | null
          exceptions?: Json | null
          extra_addresses?: Json
          extra_emails?: string[]
          extra_phones?: string[]
          first_names?: string
          forma_estipulacion_salario?: string | null
          gender?: string | null
          has_car?: boolean
          has_car_license?: boolean
          has_disability?: boolean
          has_maestria?: boolean
          has_motorcycle?: boolean
          has_motorcycle_license?: boolean
          has_srs_accreditation?: boolean
          herramientas_entregadas?: Json
          hire_date?: string | null
          hours_owed?: number | null
          id?: string
          is_studying?: boolean
          isss_estado?: string | null
          isss_number?: string | null
          kiosk_pin?: string | null
          last_names?: string
          lugar_nacimiento?: string | null
          lugar_pago?: string | null
          maestria_is_studying?: boolean
          maestria_study_duration_years?: number | null
          maestria_study_start_date?: string | null
          maestria_title?: string | null
          marital_status?: string | null
          medico_license_number?: string | null
          medio_pago?: string | null
          mtps_remitido_fecha?: string | null
          municipality?: string | null
          name?: string | null
          nationality?: string | null
          nursing_license_number?: string | null
          periodo_pago?: string | null
          pharmacist_license_number?: string | null
          phone?: string | null
          photo_url?: string | null
          profession?: string | null
          role_id?: number | null
          secondary_role_id?: number | null
          shift_id?: number | null
          srs_accreditation_expiry?: string | null
          status?: string | null
          study_duration_years?: number | null
          study_start_date?: string | null
          suplente_id?: string | null
          tiene_acreditacion_dependiente?: boolean
          tipo_ficha?: string
          username?: string | null
          weekly_contracted_hours?: number | null
          weekly_schedule?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_secondary_role_id_fkey"
            columns: ["secondary_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_suplente_id_fkey"
            columns: ["suplente_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_suplente_id_fkey"
            columns: ["suplente_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      envio_linea: {
        Row: {
          aviso: string | null
          cantidad: number
          created_at: string
          decidido_at: string | null
          decidido_por: string | null
          descripcion: string | null
          detalle: Json | null
          devuelto_at: string | null
          enviado_at: string | null
          erp_product_id: number
          error: string | null
          estado: string
          factor: number
          id: string
          id_traslado: string | null
          id_traslado_devolucion: string | null
          lotes: Json | null
          motivo_rechazo: string | null
          nota_rechazo: string | null
          posicion: number
          presentacion_tipo: string
          recibido_at: string | null
          request_id: string
          unidades: number
          updated_at: string
        }
        Insert: {
          aviso?: string | null
          cantidad: number
          created_at?: string
          decidido_at?: string | null
          decidido_por?: string | null
          descripcion?: string | null
          detalle?: Json | null
          devuelto_at?: string | null
          enviado_at?: string | null
          erp_product_id: number
          error?: string | null
          estado?: string
          factor: number
          id?: string
          id_traslado?: string | null
          id_traslado_devolucion?: string | null
          lotes?: Json | null
          motivo_rechazo?: string | null
          nota_rechazo?: string | null
          posicion: number
          presentacion_tipo: string
          recibido_at?: string | null
          request_id: string
          unidades: number
          updated_at?: string
        }
        Update: {
          aviso?: string | null
          cantidad?: number
          created_at?: string
          decidido_at?: string | null
          decidido_por?: string | null
          descripcion?: string | null
          detalle?: Json | null
          devuelto_at?: string | null
          enviado_at?: string | null
          erp_product_id?: number
          error?: string | null
          estado?: string
          factor?: number
          id?: string
          id_traslado?: string | null
          id_traslado_devolucion?: string | null
          lotes?: Json | null
          motivo_rechazo?: string | null
          nota_rechazo?: string | null
          posicion?: number
          presentacion_tipo?: string
          recibido_at?: string | null
          request_id?: string
          unidades?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "envio_linea_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_linea_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envio_linea_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_sucursal_map: {
        Row: {
          branch_id: number
          codigo: string
          erp_sucursal_id: number
          es_bodega: boolean
          inv_ubicaciones: Json | null
          nombre: string
          orden_despacho: number | null
        }
        Insert: {
          branch_id: number
          codigo: string
          erp_sucursal_id: number
          es_bodega?: boolean
          inv_ubicaciones?: Json | null
          nombre: string
          orden_despacho?: number | null
        }
        Update: {
          branch_id?: number
          codigo?: string
          erp_sucursal_id?: number
          es_bodega?: boolean
          inv_ubicaciones?: Json | null
          nombre?: string
          orden_despacho?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "erp_sucursal_map_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      espejo_conflictos: {
        Row: {
          campo: string
          changelog_id: number | null
          created_at: string
          customer_id: number
          id: number
          valor_base: string | null
          valor_erp: string | null
          valor_portal: string | null
        }
        Insert: {
          campo: string
          changelog_id?: number | null
          created_at?: string
          customer_id: number
          id?: number
          valor_base?: string | null
          valor_erp?: string | null
          valor_portal?: string | null
        }
        Update: {
          campo?: string
          changelog_id?: number | null
          created_at?: string
          customer_id?: number
          id?: number
          valor_base?: string | null
          valor_erp?: string | null
          valor_portal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "espejo_conflictos_changelog_id_fkey"
            columns: ["changelog_id"]
            isOneToOne: false
            referencedRelation: "customers_changelog"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "espejo_conflictos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "espejo_conflictos_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      export_log: {
        Row: {
          created_at: string
          detalle: Json
          employee_id: string | null
          filas: number | null
          formato: string | null
          id: string
          modulo: string
        }
        Insert: {
          created_at?: string
          detalle?: Json
          employee_id?: string | null
          filas?: number | null
          formato?: string | null
          id?: string
          modulo: string
        }
        Update: {
          created_at?: string
          detalle?: Json
          employee_id?: string | null
          filas?: number | null
          formato?: string | null
          id?: string
          modulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "export_log_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      faltas_disciplinarias: {
        Row: {
          activa: boolean
          articulo: string | null
          clave: string
          created_at: string
          nombre: string
          orden: number
        }
        Insert: {
          activa?: boolean
          articulo?: string | null
          clave: string
          created_at?: string
          nombre: string
          orden?: number
        }
        Update: {
          activa?: boolean
          articulo?: string | null
          clave?: string
          created_at?: string
          nombre?: string
          orden?: number
        }
        Relationships: []
      }
      holidays: {
        Row: {
          created_at: string | null
          holiday_date: string
          id: string
          is_recurring: boolean | null
          municipality: string | null
          name: string
          type: string
        }
        Insert: {
          created_at?: string | null
          holiday_date: string
          id?: string
          is_recurring?: boolean | null
          municipality?: string | null
          name: string
          type: string
        }
        Update: {
          created_at?: string | null
          holiday_date?: string
          id?: string
          is_recurring?: boolean | null
          municipality?: string | null
          name?: string
          type?: string
        }
        Relationships: []
      }
      identidad_vales: {
        Row: {
          created_at: string
          emitido_por: string | null
          employee_id: string
          metodo: string
          token: string
          usado_at: string | null
        }
        Insert: {
          created_at?: string
          emitido_por?: string | null
          employee_id: string
          metodo: string
          token?: string
          usado_at?: string | null
        }
        Update: {
          created_at?: string
          emitido_por?: string | null
          employee_id?: string
          metodo?: string
          token?: string
          usado_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identidad_vales_emitido_por_fkey"
            columns: ["emitido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identidad_vales_emitido_por_fkey"
            columns: ["emitido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identidad_vales_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identidad_vales_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      impresion_dispositivos: {
        Row: {
          activo: boolean
          agente_canal: string | null
          agente_version: string | null
          branch_id: number
          codigo_vinculacion: string | null
          created_at: string
          created_by: string | null
          equipo: string | null
          id: string
          impresora: string
          nombre: string
          token: string
          ultimo_latido: string | null
          vinculacion_expira: string | null
          vinculada_at: string | null
        }
        Insert: {
          activo?: boolean
          agente_canal?: string | null
          agente_version?: string | null
          branch_id: number
          codigo_vinculacion?: string | null
          created_at?: string
          created_by?: string | null
          equipo?: string | null
          id?: string
          impresora?: string
          nombre: string
          token?: string
          ultimo_latido?: string | null
          vinculacion_expira?: string | null
          vinculada_at?: string | null
        }
        Update: {
          activo?: boolean
          agente_canal?: string | null
          agente_version?: string | null
          branch_id?: number
          codigo_vinculacion?: string | null
          created_at?: string
          created_by?: string | null
          equipo?: string | null
          id?: string
          impresora?: string
          nombre?: string
          token?: string
          ultimo_latido?: string | null
          vinculacion_expira?: string | null
          vinculada_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "impresion_dispositivos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impresion_dispositivos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impresion_dispositivos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      intentos_identidad: {
        Row: {
          branch_id: number | null
          created_at: string
          exito: boolean
          id: number
          metodo: string | null
          objetivo: string | null
          proposito: string
          quien: string | null
        }
        Insert: {
          branch_id?: number | null
          created_at?: string
          exito: boolean
          id?: never
          metodo?: string | null
          objetivo?: string | null
          proposito: string
          quien?: string | null
        }
        Update: {
          branch_id?: number | null
          created_at?: string
          exito?: boolean
          id?: never
          metodo?: string | null
          objetivo?: string | null
          proposito?: string
          quien?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "intentos_identidad_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intentos_identidad_objetivo_fkey"
            columns: ["objetivo"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intentos_identidad_objetivo_fkey"
            columns: ["objetivo"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intentos_identidad_quien_fkey"
            columns: ["quien"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intentos_identidad_quien_fkey"
            columns: ["quien"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          cantidad: number
          descripcion: string | null
          detalle: string | null
          erp_product_id: number | null
          erp_sucursal_id: number
          fecha_vencimiento: string | null
          id: number
          is_vencidos: boolean
          lote: string | null
          presentacion: string | null
          sync_key: string | null
          synced_at: string
        }
        Insert: {
          cantidad?: number
          descripcion?: string | null
          detalle?: string | null
          erp_product_id?: number | null
          erp_sucursal_id: number
          fecha_vencimiento?: string | null
          id?: number
          is_vencidos?: boolean
          lote?: string | null
          presentacion?: string | null
          sync_key?: string | null
          synced_at?: string
        }
        Update: {
          cantidad?: number
          descripcion?: string | null
          detalle?: string | null
          erp_product_id?: number | null
          erp_sucursal_id?: number
          fecha_vencimiento?: string | null
          id?: number
          is_vencidos?: boolean
          lote?: string | null
          presentacion?: string | null
          sync_key?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_daily: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202609: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202610: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202611: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202612: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202701: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202702: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202703: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202704: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202705: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202706: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202707: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202708: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202709: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202710: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202711: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_daily_202712: {
        Row: {
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Insert: {
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          fecha: string
          unidades: number
        }
        Update: {
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          fecha?: string
          unidades?: number
        }
        Relationships: []
      }
      inventory_sync_huella: {
        Row: {
          created_at: string
          erp_sucursal_id: number
          filas: number
          huella: string
          is_vencidos: boolean
          verificado_at: string
        }
        Insert: {
          created_at?: string
          erp_sucursal_id: number
          filas?: number
          huella: string
          is_vencidos?: boolean
          verificado_at?: string
        }
        Update: {
          created_at?: string
          erp_sucursal_id?: number
          filas?: number
          huella?: string
          is_vencidos?: boolean
          verificado_at?: string
        }
        Relationships: []
      }
      inventory_sync_log: {
        Row: {
          erp_sucursal_id: number
          error_msg: string | null
          id: number
          is_vencidos: boolean
          items_count: number | null
          rows_upserted: number | null
          success: boolean | null
          synced_at: string
        }
        Insert: {
          erp_sucursal_id: number
          error_msg?: string | null
          id?: number
          is_vencidos?: boolean
          items_count?: number | null
          rows_upserted?: number | null
          success?: boolean | null
          synced_at?: string
        }
        Update: {
          erp_sucursal_id?: number
          error_msg?: string | null
          id?: number
          is_vencidos?: boolean
          items_count?: number | null
          rows_upserted?: number | null
          success?: boolean | null
          synced_at?: string
        }
        Relationships: []
      }
      job_watermarks: {
        Row: {
          created_at: string
          job_name: string
          updated_at: string
          watermark: string
        }
        Insert: {
          created_at?: string
          job_name: string
          updated_at?: string
          watermark: string
        }
        Update: {
          created_at?: string
          job_name?: string
          updated_at?: string
          watermark?: string
        }
        Relationships: []
      }
      kiosk_credentials: {
        Row: {
          created_at: string
          employee_id: string
          pin_hash: string
          rotated_at: string
          rotated_by: string | null
        }
        Insert: {
          created_at?: string
          employee_id: string
          pin_hash: string
          rotated_at?: string
          rotated_by?: string | null
        }
        Update: {
          created_at?: string
          employee_id?: string
          pin_hash?: string
          rotated_at?: string
          rotated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_credentials_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kiosk_credentials_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: true
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kiosk_credentials_rotated_by_fkey"
            columns: ["rotated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kiosk_credentials_rotated_by_fkey"
            columns: ["rotated_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      kiosk_devices: {
        Row: {
          branch_id: number | null
          created_at: string
          device_name: string
          device_token: string
          id: string
          last_active_at: string | null
          revoked_at: string | null
          status: string
        }
        Insert: {
          branch_id?: number | null
          created_at?: string
          device_name: string
          device_token?: string
          id?: string
          last_active_at?: string | null
          revoked_at?: string | null
          status?: string
        }
        Update: {
          branch_id?: number | null
          created_at?: string
          device_name?: string
          device_token?: string
          id?: string
          last_active_at?: string | null
          revoked_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "kiosk_devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      kiosk_pin_attempts: {
        Row: {
          created_at: string
          device_id: string
          employee_id: string | null
          id: number
          succeeded: boolean
        }
        Insert: {
          created_at?: string
          device_id: string
          employee_id?: string | null
          id?: number
          succeeded: boolean
        }
        Update: {
          created_at?: string
          device_id?: string
          employee_id?: string | null
          id?: number
          succeeded?: boolean
        }
        Relationships: []
      }
      lab_locations: {
        Row: {
          bodega_numero: string | null
          bodega_peldano: string | null
          branch_id: number
          estante: string | null
          id: number
          lab_id: number
          peldano: string | null
          ubicacion: string | null
          updated_at: string | null
          vitrina: string | null
        }
        Insert: {
          bodega_numero?: string | null
          bodega_peldano?: string | null
          branch_id: number
          estante?: string | null
          id?: number
          lab_id: number
          peldano?: string | null
          ubicacion?: string | null
          updated_at?: string | null
          vitrina?: string | null
        }
        Update: {
          bodega_numero?: string | null
          bodega_peldano?: string | null
          branch_id?: number
          estante?: string | null
          id?: number
          lab_id?: number
          peldano?: string | null
          ubicacion?: string | null
          updated_at?: string | null
          vitrina?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lab_locations_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
        ]
      }
      laboratorios: {
        Row: {
          acumula_puntos: boolean
          id: number
          nombre: string
          nombre_busq: string | null
          ocultar_en_minmax: boolean | null
          ubicacion: string | null
          updated_at: string | null
        }
        Insert: {
          acumula_puntos?: boolean
          id: number
          nombre: string
          nombre_busq?: string | null
          ocultar_en_minmax?: boolean | null
          ubicacion?: string | null
          updated_at?: string | null
        }
        Update: {
          acumula_puntos?: boolean
          id?: number
          nombre?: string
          nombre_busq?: string | null
          ocultar_en_minmax?: boolean | null
          ubicacion?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      login_rate_limit: {
        Row: {
          client_ip: string
          created_at: string
          id: number
        }
        Insert: {
          client_ip: string
          created_at?: string
          id?: number
        }
        Update: {
          client_ip?: string
          created_at?: string
          id?: number
        }
        Relationships: []
      }
      medicos: {
        Row: {
          agregado_por: string | null
          carrera: string | null
          created_at: string
          id: number
          junta: string
          nombre: string
          numero_junta: string
          origen: string
          updated_at: string
          verificado_at: string | null
        }
        Insert: {
          agregado_por?: string | null
          carrera?: string | null
          created_at?: string
          id?: never
          junta?: string
          nombre: string
          numero_junta: string
          origen?: string
          updated_at?: string
          verificado_at?: string | null
        }
        Update: {
          agregado_por?: string | null
          carrera?: string | null
          created_at?: string
          id?: never
          junta?: string
          nombre?: string
          numero_junta?: string
          origen?: string
          updated_at?: string
          verificado_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicos_agregado_por_fkey"
            columns: ["agregado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicos_agregado_por_fkey"
            columns: ["agregado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_bono_persona: {
        Row: {
          bono: number
          branch_id: number
          created_at: string
          employee_id: string
          en_prueba: boolean
          es_jefe: boolean
          id: number
          origen: string
          venta: number
          year_month: string
        }
        Insert: {
          bono?: number
          branch_id: number
          created_at?: string
          employee_id: string
          en_prueba?: boolean
          es_jefe?: boolean
          id?: never
          origen: string
          venta?: number
          year_month: string
        }
        Update: {
          bono?: number
          branch_id?: number
          created_at?: string
          employee_id?: string
          en_prueba?: boolean
          es_jefe?: boolean
          id?: never
          origen?: string
          venta?: number
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_bono_persona_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_bono_persona_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_bono_persona_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_config: {
        Row: {
          bonificaciones_activas: boolean
          bonificaciones_hasta_ym: string | null
          bono_pct_venta: number
          created_at: string
          dia_propuesta: number
          id: boolean
          margen_recuperacion_pct: number
          pago_medio_pct: number
          umbral_bono_medio: number
          umbral_bono_total: number
        }
        Insert: {
          bonificaciones_activas?: boolean
          bonificaciones_hasta_ym?: string | null
          bono_pct_venta?: number
          created_at?: string
          dia_propuesta?: number
          id?: boolean
          margen_recuperacion_pct?: number
          pago_medio_pct?: number
          umbral_bono_medio?: number
          umbral_bono_total?: number
        }
        Update: {
          bonificaciones_activas?: boolean
          bonificaciones_hasta_ym?: string | null
          bono_pct_venta?: number
          created_at?: string
          dia_propuesta?: number
          id?: boolean
          margen_recuperacion_pct?: number
          pago_medio_pct?: number
          umbral_bono_medio?: number
          umbral_bono_total?: number
        }
        Relationships: []
      }
      metas_factor_cumplimiento: {
        Row: {
          created_at: string
          desde_pct: number
          factor: number
        }
        Insert: {
          created_at?: string
          desde_pct: number
          factor: number
        }
        Update: {
          created_at?: string
          desde_pct?: number
          factor?: number
        }
        Relationships: []
      }
      metas_gasto: {
        Row: {
          anulado_at: string | null
          anulado_nota: string | null
          anulado_por: string | null
          concepto: string
          creado_por: string | null
          created_at: string
          estado: string
          id: number
          margen_pct: number
          meses: number
          monto_total: number
          nota: string | null
          ym_inicio: string
        }
        Insert: {
          anulado_at?: string | null
          anulado_nota?: string | null
          anulado_por?: string | null
          concepto: string
          creado_por?: string | null
          created_at?: string
          estado?: string
          id?: never
          margen_pct: number
          meses: number
          monto_total: number
          nota?: string | null
          ym_inicio: string
        }
        Update: {
          anulado_at?: string | null
          anulado_nota?: string | null
          anulado_por?: string | null
          concepto?: string
          creado_por?: string | null
          created_at?: string
          estado?: string
          id?: never
          margen_pct?: number
          meses?: number
          monto_total?: number
          nota?: string | null
          ym_inicio?: string
        }
        Relationships: []
      }
      metas_gasto_cuota: {
        Row: {
          branch_id: number
          created_at: string
          estado: string
          gasto_id: number
          id: number
          monto_gasto: number
          monto_venta: number
          year_month: string
        }
        Insert: {
          branch_id: number
          created_at?: string
          estado?: string
          gasto_id: number
          id?: never
          monto_gasto: number
          monto_venta: number
          year_month: string
        }
        Update: {
          branch_id?: number
          created_at?: string
          estado?: string
          gasto_id?: number
          id?: never
          monto_gasto?: number
          monto_venta?: number
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_gasto_cuota_gasto_id_fkey"
            columns: ["gasto_id"]
            isOneToOne: false
            referencedRelation: "metas_gasto"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_gasto_sala: {
        Row: {
          branch_id: number
          created_at: string
          gasto_id: number
          monto: number
        }
        Insert: {
          branch_id: number
          created_at?: string
          gasto_id: number
          monto: number
        }
        Update: {
          branch_id?: number
          created_at?: string
          gasto_id?: number
          monto?: number
        }
        Relationships: [
          {
            foreignKeyName: "metas_gasto_sala_gasto_id_fkey"
            columns: ["gasto_id"]
            isOneToOne: false
            referencedRelation: "metas_gasto"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_historial: {
        Row: {
          actor: string | null
          branch_id: number
          created_at: string
          estado_antes: string | null
          estado_despues: string | null
          evento: string
          id: number
          meta_id: number | null
          monto_antes: number | null
          monto_despues: number | null
          nota: string | null
          year_month: string
        }
        Insert: {
          actor?: string | null
          branch_id: number
          created_at?: string
          estado_antes?: string | null
          estado_despues?: string | null
          evento: string
          id?: never
          meta_id?: number | null
          monto_antes?: number | null
          monto_despues?: number | null
          nota?: string | null
          year_month: string
        }
        Update: {
          actor?: string | null
          branch_id?: number
          created_at?: string
          estado_antes?: string | null
          estado_despues?: string | null
          evento?: string
          id?: never
          meta_id?: number | null
          monto_antes?: number | null
          monto_despues?: number | null
          nota?: string | null
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_historial_meta_id_fkey"
            columns: ["meta_id"]
            isOneToOne: false
            referencedRelation: "metas_sucursal"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_resultado: {
        Row: {
          bolsa: number | null
          bono_pct_venta: number | null
          bono_tier: string | null
          branch_id: number
          congelado_at: string
          created_at: string
          margen_pct: number | null
          monto_base: number | null
          monto_meta: number | null
          monto_recuperacion: number | null
          nota: string | null
          pago_medio_pct: number | null
          pct_cumplimiento: number | null
          umbral_medio: number | null
          umbral_total: number | null
          venta_total: number
          year_month: string
        }
        Insert: {
          bolsa?: number | null
          bono_pct_venta?: number | null
          bono_tier?: string | null
          branch_id: number
          congelado_at?: string
          created_at?: string
          margen_pct?: number | null
          monto_base?: number | null
          monto_meta?: number | null
          monto_recuperacion?: number | null
          nota?: string | null
          pago_medio_pct?: number | null
          pct_cumplimiento?: number | null
          umbral_medio?: number | null
          umbral_total?: number | null
          venta_total: number
          year_month: string
        }
        Update: {
          bolsa?: number | null
          bono_pct_venta?: number | null
          bono_tier?: string | null
          branch_id?: number
          congelado_at?: string
          created_at?: string
          margen_pct?: number | null
          monto_base?: number | null
          monto_meta?: number | null
          monto_recuperacion?: number | null
          nota?: string | null
          pago_medio_pct?: number | null
          pct_cumplimiento?: number | null
          umbral_medio?: number | null
          umbral_total?: number | null
          venta_total?: number
          year_month?: string
        }
        Relationships: []
      }
      metas_sucursal: {
        Row: {
          autorizado_nota: string | null
          autorizado_por: string | null
          branch_id: number
          created_at: string
          estado: string
          gerente_at: string | null
          gerente_por: string | null
          id: number
          monto_base: number
          monto_meta: number
          monto_propuesto: number | null
          monto_recuperacion: number
          nota: string | null
          nota_devolucion: string | null
          supervisor_at: string | null
          supervisor_por: string | null
          year_month: string
        }
        Insert: {
          autorizado_nota?: string | null
          autorizado_por?: string | null
          branch_id: number
          created_at?: string
          estado?: string
          gerente_at?: string | null
          gerente_por?: string | null
          id?: never
          monto_base: number
          monto_meta: number
          monto_propuesto?: number | null
          monto_recuperacion?: number
          nota?: string | null
          nota_devolucion?: string | null
          supervisor_at?: string | null
          supervisor_por?: string | null
          year_month: string
        }
        Update: {
          autorizado_nota?: string | null
          autorizado_por?: string | null
          branch_id?: number
          created_at?: string
          estado?: string
          gerente_at?: string | null
          gerente_por?: string | null
          id?: never
          monto_base?: number
          monto_meta?: number
          monto_propuesto?: number | null
          monto_recuperacion?: number
          nota?: string | null
          nota_devolucion?: string | null
          supervisor_at?: string | null
          supervisor_por?: string | null
          year_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "metas_sucursal_autorizado_por_fkey"
            columns: ["autorizado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_sucursal_autorizado_por_fkey"
            columns: ["autorizado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_sucursal_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_sucursal_gerente_por_fkey"
            columns: ["gerente_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_sucursal_gerente_por_fkey"
            columns: ["gerente_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_sucursal_supervisor_por_fkey"
            columns: ["supervisor_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metas_sucursal_supervisor_por_fkey"
            columns: ["supervisor_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      minmax_change_requests: {
        Row: {
          current_existencia: number | null
          current_max: number | null
          current_min: number | null
          current_sales_6m: number | null
          current_sales_mes: number | null
          current_ultima_venta: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          erp_product_id: number
          erp_sucursal_id: number
          id: number
          product_name: string | null
          reason: string | null
          requested_at: string
          requested_by: string
          requested_by_id: string | null
          requested_by_name: string | null
          requested_max: number
          requested_min: number
          status: string
        }
        Insert: {
          current_existencia?: number | null
          current_max?: number | null
          current_min?: number | null
          current_sales_6m?: number | null
          current_sales_mes?: number | null
          current_ultima_venta?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          erp_product_id: number
          erp_sucursal_id: number
          id?: never
          product_name?: string | null
          reason?: string | null
          requested_at?: string
          requested_by: string
          requested_by_id?: string | null
          requested_by_name?: string | null
          requested_max: number
          requested_min: number
          status?: string
        }
        Update: {
          current_existencia?: number | null
          current_max?: number | null
          current_min?: number | null
          current_sales_6m?: number | null
          current_sales_mes?: number | null
          current_ultima_venta?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          erp_product_id?: number
          erp_sucursal_id?: number
          id?: never
          product_name?: string | null
          reason?: string | null
          requested_at?: string
          requested_by?: string
          requested_by_id?: string | null
          requested_by_name?: string | null
          requested_max?: number
          requested_min?: number
          status?: string
        }
        Relationships: []
      }
      minmax_ignored: {
        Row: {
          erp_product_id: number
          erp_sucursal_id: number
          ignored_at: string
        }
        Insert: {
          erp_product_id: number
          erp_sucursal_id: number
          ignored_at?: string
        }
        Update: {
          erp_product_id?: number
          erp_sucursal_id?: number
          ignored_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "minmax_ignored_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "minmax_ignored_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      minmax_sync_log: {
        Row: {
          checked_at: string
          created_at: string
          erp_sucursal_id: number | null
          error_msg: string | null
          id: number
          items_count: number | null
          source: string
          success: boolean
        }
        Insert: {
          checked_at?: string
          created_at?: string
          erp_sucursal_id?: number | null
          error_msg?: string | null
          id?: number
          items_count?: number | null
          source: string
          success: boolean
        }
        Update: {
          checked_at?: string
          created_at?: string
          erp_sucursal_id?: number | null
          error_msg?: string | null
          id?: number
          items_count?: number | null
          source?: string
          success?: boolean
        }
        Relationships: []
      }
      module_locks: {
        Row: {
          created_at: string
          expires_at: string
          id: number
          locked_at: string
          locked_by_id: string
          locked_by_name: string
          module_key: string
          reason: string | null
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: number
          locked_at?: string
          locked_by_id: string
          locked_by_name: string
          module_key: string
          reason?: string | null
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: number
          locked_at?: string
          locked_by_id?: string
          locked_by_name?: string
          module_key?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "module_locks_locked_by_id_fkey"
            columns: ["locked_by_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "module_locks_locked_by_id_fkey"
            columns: ["locked_by_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_refresh_state: {
        Row: {
          created_at: string
          last_writes: number
          mv_name: string
          refreshed_at: string | null
        }
        Insert: {
          created_at?: string
          last_writes?: number
          mv_name: string
          refreshed_at?: string | null
        }
        Update: {
          created_at?: string
          last_writes?: number
          mv_name?: string
          refreshed_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          branch_id: number | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          link: string | null
          metadata: Json
          read_at: string | null
          recipient_id: string
          title: string
          type: string
        }
        Insert: {
          body?: string
          branch_id?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          recipient_id: string
          title: string
          type: string
        }
        Update: {
          body?: string
          branch_id?: number | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          link?: string | null
          metadata?: Json
          read_at?: string | null
          recipient_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      orphan_objects_registry: {
        Row: {
          created_at: string
          detected_at: string
          id: number
          kind: string
          notes: string | null
          ref: string
          resolved_at: string | null
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          detected_at?: string
          id?: number
          kind: string
          notes?: string | null
          ref: string
          resolved_at?: string | null
          status?: string
          title: string
        }
        Update: {
          created_at?: string
          detected_at?: string
          id?: number
          kind?: string
          notes?: string | null
          ref?: string
          resolved_at?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      overtime_bank: {
        Row: {
          created_at: string | null
          created_by: string | null
          employee_id: string
          hours: number
          id: string
          notes: string | null
          period_id: string | null
          subtype: string | null
          type: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          employee_id: string
          hours: number
          id?: string
          notes?: string | null
          period_id?: string | null
          subtype?: string | null
          type: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          employee_id?: string
          hours?: number
          id?: string
          notes?: string | null
          period_id?: string | null
          subtype?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "overtime_bank_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_bank_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_bank_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_entries: {
        Row: {
          afp_deduction: number | null
          bonifications: number | null
          branch_id: number | null
          created_at: string | null
          days_worked: number | null
          edit_history: Json | null
          employee_id: string
          extra_hours_diurnal: number | null
          extra_hours_nocturnal: number | null
          holiday_surcharge: number | null
          id: string
          isss_deduction: number | null
          net_pay: number | null
          night_hours_extra: number | null
          night_hours_ordinary: number | null
          order_discount: number | null
          ordinary_salary: number | null
          other_discounts: number | null
          period_id: string
          renta_deduction: number | null
          salary_advance: number | null
          status: string | null
          subtotal_a: number | null
          subtotal_b: number | null
          total_deductions: number | null
          updated_at: string | null
          vacation_bonus: number | null
          viaticos: number | null
          viaticos_detail: string | null
        }
        Insert: {
          afp_deduction?: number | null
          bonifications?: number | null
          branch_id?: number | null
          created_at?: string | null
          days_worked?: number | null
          edit_history?: Json | null
          employee_id: string
          extra_hours_diurnal?: number | null
          extra_hours_nocturnal?: number | null
          holiday_surcharge?: number | null
          id?: string
          isss_deduction?: number | null
          net_pay?: number | null
          night_hours_extra?: number | null
          night_hours_ordinary?: number | null
          order_discount?: number | null
          ordinary_salary?: number | null
          other_discounts?: number | null
          period_id: string
          renta_deduction?: number | null
          salary_advance?: number | null
          status?: string | null
          subtotal_a?: number | null
          subtotal_b?: number | null
          total_deductions?: number | null
          updated_at?: string | null
          vacation_bonus?: number | null
          viaticos?: number | null
          viaticos_detail?: string | null
        }
        Update: {
          afp_deduction?: number | null
          bonifications?: number | null
          branch_id?: number | null
          created_at?: string | null
          days_worked?: number | null
          edit_history?: Json | null
          employee_id?: string
          extra_hours_diurnal?: number | null
          extra_hours_nocturnal?: number | null
          holiday_surcharge?: number | null
          id?: string
          isss_deduction?: number | null
          net_pay?: number | null
          night_hours_extra?: number | null
          night_hours_ordinary?: number | null
          order_discount?: number | null
          ordinary_salary?: number | null
          other_discounts?: number | null
          period_id?: string
          renta_deduction?: number | null
          salary_advance?: number | null
          status?: string | null
          subtotal_a?: number | null
          subtotal_b?: number | null
          total_deductions?: number | null
          updated_at?: string | null
          vacation_bonus?: number | null
          viaticos?: number | null
          viaticos_detail?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          branch_id: number | null
          created_at: string | null
          created_by: string | null
          end_date: string
          id: string
          metadata: Json | null
          name: string
          paid_at: string | null
          paid_by: string | null
          pay_date: string | null
          period_type: string
          start_date: string
          status: string
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: number | null
          created_at?: string | null
          created_by?: string | null
          end_date: string
          id?: string
          metadata?: Json | null
          name: string
          paid_at?: string | null
          paid_by?: string | null
          pay_date?: string | null
          period_type?: string
          start_date: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: number | null
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          id?: string
          metadata?: Json | null
          name?: string
          paid_at?: string | null
          paid_by?: string | null
          pay_date?: string | null
          period_type?: string
          start_date?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pedido_apoyo: {
        Row: {
          employee_id: string
          erp_sucursal_id: number
          id: string
          pedido_id: string
          registered_at: string | null
          registered_by: string | null
          tipo: string
        }
        Insert: {
          employee_id: string
          erp_sucursal_id: number
          id?: string
          pedido_id: string
          registered_at?: string | null
          registered_by?: string | null
          tipo?: string
        }
        Update: {
          employee_id?: string
          erp_sucursal_id?: number
          id?: string
          pedido_id?: string
          registered_at?: string | null
          registered_by?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_apoyo_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_apoyo_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_apoyo_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_devolucion: {
        Row: {
          aviso: string | null
          cantidad: number
          clave: string
          created_at: string
          decidida_at: string | null
          decidida_por: string | null
          decision_nota: string | null
          detalle: Json | null
          enviado_at: string | null
          enviado_por: string | null
          erp_product_id: number
          erp_sucursal_id: number
          error_msg: string | null
          estado: string
          evidencia_urls: Json
          id: string
          id_traslado: string | null
          motivo: string
          motivo_rechazo: string | null
          nota: string | null
          numero_vale: string | null
          pedido_id: string
          pedido_item_id: number
          recibido_at: string | null
          recibido_por: string | null
          sentido: string | null
          solicitada_at: string
          solicitada_por: string | null
          updated_at: string
          viaja: boolean
        }
        Insert: {
          aviso?: string | null
          cantidad: number
          clave: string
          created_at?: string
          decidida_at?: string | null
          decidida_por?: string | null
          decision_nota?: string | null
          detalle?: Json | null
          enviado_at?: string | null
          enviado_por?: string | null
          erp_product_id: number
          erp_sucursal_id: number
          error_msg?: string | null
          estado?: string
          evidencia_urls?: Json
          id?: string
          id_traslado?: string | null
          motivo: string
          motivo_rechazo?: string | null
          nota?: string | null
          numero_vale?: string | null
          pedido_id: string
          pedido_item_id: number
          recibido_at?: string | null
          recibido_por?: string | null
          sentido?: string | null
          solicitada_at?: string
          solicitada_por?: string | null
          updated_at?: string
          viaja: boolean
        }
        Update: {
          aviso?: string | null
          cantidad?: number
          clave?: string
          created_at?: string
          decidida_at?: string | null
          decidida_por?: string | null
          decision_nota?: string | null
          detalle?: Json | null
          enviado_at?: string | null
          enviado_por?: string | null
          erp_product_id?: number
          erp_sucursal_id?: number
          error_msg?: string | null
          estado?: string
          evidencia_urls?: Json
          id?: string
          id_traslado?: string | null
          motivo?: string
          motivo_rechazo?: string | null
          nota?: string | null
          numero_vale?: string | null
          pedido_id?: string
          pedido_item_id?: number
          recibido_at?: string | null
          recibido_por?: string | null
          sentido?: string | null
          solicitada_at?: string
          solicitada_por?: string | null
          updated_at?: string
          viaja?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "pedido_devolucion_decidida_por_fkey"
            columns: ["decidida_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_decidida_por_fkey"
            columns: ["decidida_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_enviado_por_fkey"
            columns: ["enviado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_recibido_por_fkey"
            columns: ["recibido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_solicitada_por_fkey"
            columns: ["solicitada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_devolucion_solicitada_por_fkey"
            columns: ["solicitada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_item_eventos: {
        Row: {
          created_at: string
          erp_sucursal_id: number
          hecho_por: string | null
          id: string
          nota: string | null
          pedido_id: string
          pedido_item_id: number
          resolucion_tipo: string | null
          tipo: string
        }
        Insert: {
          created_at?: string
          erp_sucursal_id: number
          hecho_por?: string | null
          id?: string
          nota?: string | null
          pedido_id: string
          pedido_item_id: number
          resolucion_tipo?: string | null
          tipo: string
        }
        Update: {
          created_at?: string
          erp_sucursal_id?: number
          hecho_por?: string | null
          id?: string
          nota?: string | null
          pedido_id?: string
          pedido_item_id?: number
          resolucion_tipo?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_item_eventos_hecho_por_fkey"
            columns: ["hecho_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_item_eventos_hecho_por_fkey"
            columns: ["hecho_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_item_eventos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_item_eventos_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_items"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_items: {
        Row: {
          agotamiento: boolean | null
          caja_especial: boolean
          cantidad_asignada: number
          cantidad_enviada: number | null
          cantidad_problema: number | null
          cantidad_recibida: number | null
          confirmado_suc_at: string | null
          confirmado_suc_por: string | null
          dispatch_factor: number | null
          dispatch_multiplo: number | null
          dispatch_tipo: string | null
          enviado_at: string | null
          enviado_por: string | null
          erp_presentacion_id: number | null
          erp_product_id: number
          erp_sucursal_id: number
          error_tipo: string | null
          es_extra: boolean
          factor: number | null
          falta_caja: boolean
          id: number
          lotes_asignados: Json | null
          max_qty_snapshot: number | null
          min_qty_snapshot: number | null
          motivo_no_envio: string | null
          nota_diferencia: string | null
          nota_rechazo: string | null
          pedido_id: string
          received_at: string | null
          received_by: string | null
          rechazado_at: string | null
          rechazado_por: string | null
          resolucion_nota: string | null
          resolucion_ronda: number
          resolucion_status: string | null
          resolucion_tipo: string | null
          resolucion_vence_at: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          revision_minmax: boolean
          sin_stock: boolean
          status: string
          stock_packs_snapshot: number | null
          supervisado_at: string | null
          supervisado_por: string | null
          urgencia_pct_snapshot: number | null
        }
        Insert: {
          agotamiento?: boolean | null
          caja_especial?: boolean
          cantidad_asignada: number
          cantidad_enviada?: number | null
          cantidad_problema?: number | null
          cantidad_recibida?: number | null
          confirmado_suc_at?: string | null
          confirmado_suc_por?: string | null
          dispatch_factor?: number | null
          dispatch_multiplo?: number | null
          dispatch_tipo?: string | null
          enviado_at?: string | null
          enviado_por?: string | null
          erp_presentacion_id?: number | null
          erp_product_id: number
          erp_sucursal_id: number
          error_tipo?: string | null
          es_extra?: boolean
          factor?: number | null
          falta_caja?: boolean
          id?: number
          lotes_asignados?: Json | null
          max_qty_snapshot?: number | null
          min_qty_snapshot?: number | null
          motivo_no_envio?: string | null
          nota_diferencia?: string | null
          nota_rechazo?: string | null
          pedido_id: string
          received_at?: string | null
          received_by?: string | null
          rechazado_at?: string | null
          rechazado_por?: string | null
          resolucion_nota?: string | null
          resolucion_ronda?: number
          resolucion_status?: string | null
          resolucion_tipo?: string | null
          resolucion_vence_at?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          revision_minmax?: boolean
          sin_stock?: boolean
          status?: string
          stock_packs_snapshot?: number | null
          supervisado_at?: string | null
          supervisado_por?: string | null
          urgencia_pct_snapshot?: number | null
        }
        Update: {
          agotamiento?: boolean | null
          caja_especial?: boolean
          cantidad_asignada?: number
          cantidad_enviada?: number | null
          cantidad_problema?: number | null
          cantidad_recibida?: number | null
          confirmado_suc_at?: string | null
          confirmado_suc_por?: string | null
          dispatch_factor?: number | null
          dispatch_multiplo?: number | null
          dispatch_tipo?: string | null
          enviado_at?: string | null
          enviado_por?: string | null
          erp_presentacion_id?: number | null
          erp_product_id?: number
          erp_sucursal_id?: number
          error_tipo?: string | null
          es_extra?: boolean
          factor?: number | null
          falta_caja?: boolean
          id?: number
          lotes_asignados?: Json | null
          max_qty_snapshot?: number | null
          min_qty_snapshot?: number | null
          motivo_no_envio?: string | null
          nota_diferencia?: string | null
          nota_rechazo?: string | null
          pedido_id?: string
          received_at?: string | null
          received_by?: string | null
          rechazado_at?: string | null
          rechazado_por?: string | null
          resolucion_nota?: string | null
          resolucion_ronda?: number
          resolucion_status?: string | null
          resolucion_tipo?: string | null
          resolucion_vence_at?: string | null
          resuelto_at?: string | null
          resuelto_por?: string | null
          revision_minmax?: boolean
          sin_stock?: boolean
          status?: string
          stock_packs_snapshot?: number | null
          supervisado_at?: string | null
          supervisado_por?: string | null
          urgencia_pct_snapshot?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_items_confirmado_suc_por_fkey"
            columns: ["confirmado_suc_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_confirmado_suc_por_fkey"
            columns: ["confirmado_suc_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_erp_presentacion_id_fkey"
            columns: ["erp_presentacion_id"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_rechazado_por_fkey"
            columns: ["rechazado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_rechazado_por_fkey"
            columns: ["rechazado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_supervisado_por_fkey"
            columns: ["supervisado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_items_supervisado_por_fkey"
            columns: ["supervisado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_pausa_historial: {
        Row: {
          created_at: string
          erp_sucursal_id: number
          id: string
          pausado_at: string
          pausado_por: string | null
          pedido_id: string
          razon: string | null
          reanudado_at: string | null
          reanudado_por: string | null
        }
        Insert: {
          created_at?: string
          erp_sucursal_id: number
          id?: string
          pausado_at?: string
          pausado_por?: string | null
          pedido_id: string
          razon?: string | null
          reanudado_at?: string | null
          reanudado_por?: string | null
        }
        Update: {
          created_at?: string
          erp_sucursal_id?: number
          id?: string
          pausado_at?: string
          pausado_por?: string | null
          pedido_id?: string
          razon?: string | null
          reanudado_at?: string | null
          reanudado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_pausa_historial_pausado_por_fkey"
            columns: ["pausado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_pausa_historial_pausado_por_fkey"
            columns: ["pausado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_pausa_historial_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_recepcion_extras: {
        Row: {
          cantidad: number
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          id: number
          nota: string | null
          pedido_id: string
          reported_by: string | null
        }
        Insert: {
          cantidad: number
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          id?: number
          nota?: string | null
          pedido_id: string
          reported_by?: string | null
        }
        Update: {
          cantidad?: number
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          id?: number
          nota?: string | null
          pedido_id?: string
          reported_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_recepcion_extras_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_product_fk"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pre_product_fk"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_recepcion_firmas: {
        Row: {
          added_by: string | null
          created_at: string
          employee_id: string
          erp_sucursal_id: number
          id: number
          pedido_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          employee_id: string
          erp_sucursal_id: number
          id?: number
          pedido_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          employee_id?: string
          erp_sucursal_id?: number
          id?: number
          pedido_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_recepcion_firmas_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prf_employee_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prf_employee_fk"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_sucursal_status: {
        Row: {
          caja_map: Json | null
          cajas_danadas: Json | null
          cajas_electrolit: number
          cajas_especiales: Json | null
          cajas_especiales_llegadas: Json | null
          cajas_extra: number | null
          cajas_extra_notas: Json | null
          cajas_recibidas: Json | null
          codigo: string | null
          confirmado_correccion_at: string | null
          confirmado_correccion_por: string | null
          corregido_bodega_at: string | null
          corregido_bodega_nota: string | null
          corregido_bodega_por: string | null
          created_at: string
          diferencias_reportadas_at: string | null
          diferencias_reportadas_por: string | null
          electrolit_faltantes: number | null
          electrolit_ok: boolean | null
          entrega_programada_at: string | null
          entrega_programada_historial: Json | null
          erp_sucursal_id: number
          falta_caja_at: string | null
          falta_cajas: Json
          finalizado_at: string | null
          finalizado_por: string | null
          hojas_recibidas: Json
          id: string
          iniciado_at: string | null
          iniciado_por: string | null
          llegada_fisica_at: string | null
          llegada_fisica_por: string | null
          llegada_nota: string | null
          llegada_tipo: string | null
          pagina_items: Json | null
          paginas: Json | null
          pausa_razon: string | null
          pausado_at: string | null
          pedido_id: string
          reanudado_at: string | null
          reanudado_por: string | null
          recibido_erp_at: string | null
          recibido_erp_por: string | null
          reenvio_bodega_at: string | null
          reenvio_por: string | null
          reenvios_historial: Json | null
          segunda_llegada_at: string | null
          total_cajas: number | null
        }
        Insert: {
          caja_map?: Json | null
          cajas_danadas?: Json | null
          cajas_electrolit?: number
          cajas_especiales?: Json | null
          cajas_especiales_llegadas?: Json | null
          cajas_extra?: number | null
          cajas_extra_notas?: Json | null
          cajas_recibidas?: Json | null
          codigo?: string | null
          confirmado_correccion_at?: string | null
          confirmado_correccion_por?: string | null
          corregido_bodega_at?: string | null
          corregido_bodega_nota?: string | null
          corregido_bodega_por?: string | null
          created_at?: string
          diferencias_reportadas_at?: string | null
          diferencias_reportadas_por?: string | null
          electrolit_faltantes?: number | null
          electrolit_ok?: boolean | null
          entrega_programada_at?: string | null
          entrega_programada_historial?: Json | null
          erp_sucursal_id: number
          falta_caja_at?: string | null
          falta_cajas?: Json
          finalizado_at?: string | null
          finalizado_por?: string | null
          hojas_recibidas?: Json
          id?: string
          iniciado_at?: string | null
          iniciado_por?: string | null
          llegada_fisica_at?: string | null
          llegada_fisica_por?: string | null
          llegada_nota?: string | null
          llegada_tipo?: string | null
          pagina_items?: Json | null
          paginas?: Json | null
          pausa_razon?: string | null
          pausado_at?: string | null
          pedido_id: string
          reanudado_at?: string | null
          reanudado_por?: string | null
          recibido_erp_at?: string | null
          recibido_erp_por?: string | null
          reenvio_bodega_at?: string | null
          reenvio_por?: string | null
          reenvios_historial?: Json | null
          segunda_llegada_at?: string | null
          total_cajas?: number | null
        }
        Update: {
          caja_map?: Json | null
          cajas_danadas?: Json | null
          cajas_electrolit?: number
          cajas_especiales?: Json | null
          cajas_especiales_llegadas?: Json | null
          cajas_extra?: number | null
          cajas_extra_notas?: Json | null
          cajas_recibidas?: Json | null
          codigo?: string | null
          confirmado_correccion_at?: string | null
          confirmado_correccion_por?: string | null
          corregido_bodega_at?: string | null
          corregido_bodega_nota?: string | null
          corregido_bodega_por?: string | null
          created_at?: string
          diferencias_reportadas_at?: string | null
          diferencias_reportadas_por?: string | null
          electrolit_faltantes?: number | null
          electrolit_ok?: boolean | null
          entrega_programada_at?: string | null
          entrega_programada_historial?: Json | null
          erp_sucursal_id?: number
          falta_caja_at?: string | null
          falta_cajas?: Json
          finalizado_at?: string | null
          finalizado_por?: string | null
          hojas_recibidas?: Json
          id?: string
          iniciado_at?: string | null
          iniciado_por?: string | null
          llegada_fisica_at?: string | null
          llegada_fisica_por?: string | null
          llegada_nota?: string | null
          llegada_tipo?: string | null
          pagina_items?: Json | null
          paginas?: Json | null
          pausa_razon?: string | null
          pausado_at?: string | null
          pedido_id?: string
          reanudado_at?: string | null
          reanudado_por?: string | null
          recibido_erp_at?: string | null
          recibido_erp_por?: string | null
          reenvio_bodega_at?: string | null
          reenvio_por?: string | null
          reenvios_historial?: Json | null
          segunda_llegada_at?: string | null
          total_cajas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pedido_sucursal_status_confirmado_correccion_por_fkey"
            columns: ["confirmado_correccion_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_confirmado_correccion_por_fkey"
            columns: ["confirmado_correccion_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_corregido_bodega_por_fkey"
            columns: ["corregido_bodega_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_corregido_bodega_por_fkey"
            columns: ["corregido_bodega_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_diferencias_reportadas_por_fkey"
            columns: ["diferencias_reportadas_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_diferencias_reportadas_por_fkey"
            columns: ["diferencias_reportadas_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_finalizado_por_fkey"
            columns: ["finalizado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_finalizado_por_fkey"
            columns: ["finalizado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_iniciado_por_fkey"
            columns: ["iniciado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_iniciado_por_fkey"
            columns: ["iniciado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_llegada_fisica_por_fkey"
            columns: ["llegada_fisica_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_llegada_fisica_por_fkey"
            columns: ["llegada_fisica_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_recibido_erp_por_fkey"
            columns: ["recibido_erp_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_recibido_erp_por_fkey"
            columns: ["recibido_erp_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_reenvio_por_fkey"
            columns: ["reenvio_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_sucursal_status_reenvio_por_fkey"
            columns: ["reenvio_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_traslado_erp: {
        Row: {
          creado_por: string | null
          created_at: string
          detalle: Json | null
          erp_sucursal_id: number
          error_msg: string | null
          estado: string
          hallazgos: Json
          id: string
          id_traslado: string | null
          lineas: number
          modo: string
          ms_total: number | null
          numero_vale: string | null
          paso: string
          pedido_id: string
          productos: number
          reanudaciones: number
          total: number
          unidades: number
          updated_at: string
        }
        Insert: {
          creado_por?: string | null
          created_at?: string
          detalle?: Json | null
          erp_sucursal_id: number
          error_msg?: string | null
          estado: string
          hallazgos?: Json
          id?: string
          id_traslado?: string | null
          lineas?: number
          modo: string
          ms_total?: number | null
          numero_vale?: string | null
          paso: string
          pedido_id: string
          productos?: number
          reanudaciones?: number
          total?: number
          unidades?: number
          updated_at?: string
        }
        Update: {
          creado_por?: string | null
          created_at?: string
          detalle?: Json | null
          erp_sucursal_id?: number
          error_msg?: string | null
          estado?: string
          hallazgos?: Json
          id?: string
          id_traslado?: string | null
          lineas?: number
          modo?: string
          ms_total?: number | null
          numero_vale?: string | null
          paso?: string
          pedido_id?: string
          productos?: number
          reanudaciones?: number
          total?: number
          unidades?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_traslado_erp_erp_sucursal_id_fkey"
            columns: ["erp_sucursal_id"]
            isOneToOne: false
            referencedRelation: "erp_sucursal_map"
            referencedColumns: ["erp_sucursal_id"]
          },
          {
            foreignKeyName: "pedido_traslado_erp_erp_sucursal_id_fkey"
            columns: ["erp_sucursal_id"]
            isOneToOne: false
            referencedRelation: "mv_primera_venta_producto"
            referencedColumns: ["erp_sucursal_id"]
          },
          {
            foreignKeyName: "pedido_traslado_erp_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_traslado_linea: {
        Row: {
          aviso: string | null
          cantidad: number
          clave: string
          created_at: string
          detalle: Json | null
          enviado_at: string | null
          erp_product_id: number
          erp_sucursal_id: number
          error_msg: string | null
          estado: string
          hoja: number | null
          id: string
          id_traslado: string | null
          numero_vale: string | null
          pedido_id: string
          pedido_item_id: number
          recibido_at: string | null
          recibido_por: string | null
          run_id: string | null
          updated_at: string
        }
        Insert: {
          aviso?: string | null
          cantidad: number
          clave: string
          created_at?: string
          detalle?: Json | null
          enviado_at?: string | null
          erp_product_id: number
          erp_sucursal_id: number
          error_msg?: string | null
          estado?: string
          hoja?: number | null
          id?: string
          id_traslado?: string | null
          numero_vale?: string | null
          pedido_id: string
          pedido_item_id: number
          recibido_at?: string | null
          recibido_por?: string | null
          run_id?: string | null
          updated_at?: string
        }
        Update: {
          aviso?: string | null
          cantidad?: number
          clave?: string
          created_at?: string
          detalle?: Json | null
          enviado_at?: string | null
          erp_product_id?: number
          erp_sucursal_id?: number
          error_msg?: string | null
          estado?: string
          hoja?: number | null
          id?: string
          id_traslado?: string | null
          numero_vale?: string | null
          pedido_id?: string
          pedido_item_id?: number
          recibido_at?: string | null
          recibido_por?: string | null
          run_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedido_traslado_linea_erp_sucursal_id_fkey"
            columns: ["erp_sucursal_id"]
            isOneToOne: false
            referencedRelation: "erp_sucursal_map"
            referencedColumns: ["erp_sucursal_id"]
          },
          {
            foreignKeyName: "pedido_traslado_linea_erp_sucursal_id_fkey"
            columns: ["erp_sucursal_id"]
            isOneToOne: false
            referencedRelation: "mv_primera_venta_producto"
            referencedColumns: ["erp_sucursal_id"]
          },
          {
            foreignKeyName: "pedido_traslado_linea_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_traslado_linea_pedido_item_id_fkey"
            columns: ["pedido_item_id"]
            isOneToOne: false
            referencedRelation: "pedido_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedido_traslado_linea_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "pedido_traslado_erp"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          anulado_at: string | null
          anulado_por: string | null
          created_at: string
          created_by: string | null
          enviado_at: string | null
          enviado_por: string | null
          id: string
          motivo_anulacion: string | null
          notes: string | null
          numero: number
          responsable_id: string | null
          revisado_por: string | null
          status: string
          sucursal_ids: number[] | null
        }
        Insert: {
          anulado_at?: string | null
          anulado_por?: string | null
          created_at?: string
          created_by?: string | null
          enviado_at?: string | null
          enviado_por?: string | null
          id?: string
          motivo_anulacion?: string | null
          notes?: string | null
          numero?: number
          responsable_id?: string | null
          revisado_por?: string | null
          status?: string
          sucursal_ids?: number[] | null
        }
        Update: {
          anulado_at?: string | null
          anulado_por?: string | null
          created_at?: string
          created_by?: string | null
          enviado_at?: string | null
          enviado_por?: string | null
          id?: string
          motivo_anulacion?: string | null
          notes?: string | null
          numero?: number
          responsable_id?: string | null
          revisado_por?: string | null
          status?: string
          sucursal_ids?: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_snapshots: {
        Row: {
          created_at: string
          created_by: string | null
          datos: Json
          id: string
          nombre: string
          sucursal_ids: number[]
          total_filas: number
          total_packs: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          datos: Json
          id?: string
          nombre: string
          sucursal_ids: number[]
          total_filas?: number
          total_packs?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          datos?: Json
          id?: string
          nombre?: string
          sucursal_ids?: number[]
          total_filas?: number
          total_packs?: number
        }
        Relationships: []
      }
      periodos_fiscales: {
        Row: {
          a_pagar: number
          cerrado_at: string | null
          cerrado_por: string | null
          created_at: string
          credito_declarable: number
          credito_fiscal: number
          debito_fiscal: number
          declarado_real: number | null
          estado: string
          id: number
          nota: string | null
          percepcion_pagada: number
          periodo: string
          remanente_entra: number
          remanente_sale: number
          retencion_sufrida: number
          updated_at: string
        }
        Insert: {
          a_pagar?: number
          cerrado_at?: string | null
          cerrado_por?: string | null
          created_at?: string
          credito_declarable?: number
          credito_fiscal?: number
          debito_fiscal?: number
          declarado_real?: number | null
          estado?: string
          id?: number
          nota?: string | null
          percepcion_pagada?: number
          periodo: string
          remanente_entra?: number
          remanente_sale?: number
          retencion_sufrida?: number
          updated_at?: string
        }
        Update: {
          a_pagar?: number
          cerrado_at?: string | null
          cerrado_por?: string | null
          created_at?: string
          credito_declarable?: number
          credito_fiscal?: number
          debito_fiscal?: number
          declarado_real?: number | null
          estado?: string
          id?: number
          nota?: string | null
          percepcion_pagada?: number
          periodo?: string
          remanente_entra?: number
          remanente_sale?: number
          retencion_sufrida?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "periodos_fiscales_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "periodos_fiscales_cerrado_por_fkey"
            columns: ["cerrado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_proveedores: {
        Row: {
          activo: boolean
          codigo: string
          created_at: string
          nombre: string
          nombres_en_el_papel: string[]
          orden: number
        }
        Insert: {
          activo?: boolean
          codigo: string
          created_at?: string
          nombre: string
          nombres_en_el_papel?: string[]
          orden?: number
        }
        Update: {
          activo?: boolean
          codigo?: string
          created_at?: string
          nombre?: string
          nombres_en_el_papel?: string[]
          orden?: number
        }
        Relationships: []
      }
      practicantes: {
        Row: {
          alt_identity_document: string | null
          birth_date: string | null
          branch_id: number
          convenio_url: string
          created_at: string
          created_by: string | null
          dui: string | null
          estado: string
          fecha_fin: string
          fecha_inicio: string
          first_names: string
          horas_requeridas: number | null
          id: string
          institucion_educativa: string
          last_names: string
          notas: string | null
          phone: string | null
          supervisor_employee_id: string | null
          tutor_nombre: string
          tutor_telefono: string | null
        }
        Insert: {
          alt_identity_document?: string | null
          birth_date?: string | null
          branch_id: number
          convenio_url: string
          created_at?: string
          created_by?: string | null
          dui?: string | null
          estado?: string
          fecha_fin: string
          fecha_inicio: string
          first_names: string
          horas_requeridas?: number | null
          id?: string
          institucion_educativa: string
          last_names: string
          notas?: string | null
          phone?: string | null
          supervisor_employee_id?: string | null
          tutor_nombre: string
          tutor_telefono?: string | null
        }
        Update: {
          alt_identity_document?: string | null
          birth_date?: string | null
          branch_id?: number
          convenio_url?: string
          created_at?: string
          created_by?: string | null
          dui?: string | null
          estado?: string
          fecha_fin?: string
          fecha_inicio?: string
          first_names?: string
          horas_requeridas?: number | null
          id?: string
          institucion_educativa?: string
          last_names?: string
          notas?: string | null
          phone?: string | null
          supervisor_employee_id?: string | null
          tutor_nombre?: string
          tutor_telefono?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "practicantes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicantes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicantes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicantes_supervisor_employee_id_fkey"
            columns: ["supervisor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "practicantes_supervisor_employee_id_fkey"
            columns: ["supervisor_employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      presentaciones: {
        Row: {
          id: number
          tipo: string | null
          updated_at: string | null
        }
        Insert: {
          id: number
          tipo?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: number
          tipo?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      product_active_principles: {
        Row: {
          concentracion: string | null
          created_at: string | null
          id: number
          nombre: string
          orden: number | null
          product_id: number
        }
        Insert: {
          concentracion?: string | null
          created_at?: string | null
          id?: number
          nombre: string
          orden?: number | null
          product_id: number
        }
        Update: {
          concentracion?: string | null
          created_at?: string | null
          id?: number
          nombre?: string
          orden?: number | null
          product_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_active_principles_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_active_principles_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: number
          nombre: string
        }
        Insert: {
          created_at?: string
          id?: number
          nombre: string
        }
        Update: {
          created_at?: string
          id?: number
          nombre?: string
        }
        Relationships: []
      }
      product_last_sale: {
        Row: {
          erp_product_id: number
          erp_sucursal_id: number
          last_sale_date: string
        }
        Insert: {
          erp_product_id: number
          erp_sucursal_id: number
          last_sale_date: string
        }
        Update: {
          erp_product_id?: number
          erp_sucursal_id?: number
          last_sale_date?: string
        }
        Relationships: []
      }
      product_locations: {
        Row: {
          bodega_numero: string | null
          bodega_peldano: string | null
          branch_id: number
          estante: string | null
          id: number
          peldano: string | null
          product_id: number
          ubicacion: string
          updated_at: string
          vitrina: string | null
        }
        Insert: {
          bodega_numero?: string | null
          bodega_peldano?: string | null
          branch_id: number
          estante?: string | null
          id?: number
          peldano?: string | null
          product_id: number
          ubicacion?: string
          updated_at?: string
          vitrina?: string | null
        }
        Update: {
          bodega_numero?: string | null
          bodega_peldano?: string | null
          branch_id?: number
          estante?: string | null
          id?: number
          peldano?: string | null
          product_id?: number
          ubicacion?: string
          updated_at?: string
          vitrina?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_locations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_locations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_locations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      product_precios: {
        Row: {
          activo: boolean | null
          clinica: number | null
          costo: number | null
          descripcion: string | null
          descuento_1: number | null
          factor: number | null
          id: number
          id_presentacion: number
          mayoreo: number | null
          precio_7: number | null
          premium: number | null
          product_id: number
          updated_at: string | null
          vineta: number | null
          vip: number | null
        }
        Insert: {
          activo?: boolean | null
          clinica?: number | null
          costo?: number | null
          descripcion?: string | null
          descuento_1?: number | null
          factor?: number | null
          id?: never
          id_presentacion: number
          mayoreo?: number | null
          precio_7?: number | null
          premium?: number | null
          product_id: number
          updated_at?: string | null
          vineta?: number | null
          vip?: number | null
        }
        Update: {
          activo?: boolean | null
          clinica?: number | null
          costo?: number | null
          descripcion?: string | null
          descuento_1?: number | null
          factor?: number | null
          id?: never
          id_presentacion?: number
          mayoreo?: number | null
          precio_7?: number | null
          premium?: number | null
          product_id?: number
          updated_at?: string | null
          vineta?: number | null
          vip?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_precios_id_presentacion_fkey"
            columns: ["id_presentacion"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      product_precios_changelog: {
        Row: {
          campo: string
          detected_at: string
          id: number
          id_presentacion: number
          product_id: number
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Insert: {
          campo: string
          detected_at?: string
          id?: number
          id_presentacion: number
          product_id: number
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          campo?: string
          detected_at?: string
          id?: number
          id_presentacion?: number
          product_id?: number
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ppc_presentacion"
            columns: ["id_presentacion"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ppc_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ppc_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      product_precios_history: {
        Row: {
          clinica: number | null
          costo: number | null
          descuento_1: number | null
          id: number
          id_presentacion: number
          mayoreo: number | null
          precio_7: number | null
          premium: number | null
          product_id: number
          valid_from: string
          valid_until: string | null
          vineta: number | null
          vip: number | null
        }
        Insert: {
          clinica?: number | null
          costo?: number | null
          descuento_1?: number | null
          id?: number
          id_presentacion: number
          mayoreo?: number | null
          precio_7?: number | null
          premium?: number | null
          product_id: number
          valid_from?: string
          valid_until?: string | null
          vineta?: number | null
          vip?: number | null
        }
        Update: {
          clinica?: number | null
          costo?: number | null
          descuento_1?: number | null
          id?: number
          id_presentacion?: number
          mayoreo?: number | null
          precio_7?: number | null
          premium?: number | null
          product_id?: number
          valid_from?: string
          valid_until?: string | null
          vineta?: number | null
          vip?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pph_presentacion"
            columns: ["id_presentacion"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pph_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pph_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sales_monthly_agg: {
        Row: {
          branch_id: number
          cantidad: number
          descripcion: string | null
          erp_product_id: number
          neto: number
          presentacion: string
          ultima_venta: string | null
          updated_at: string
          year_month: string
        }
        Insert: {
          branch_id: number
          cantidad?: number
          descripcion?: string | null
          erp_product_id: number
          neto?: number
          presentacion?: string
          ultima_venta?: string | null
          updated_at?: string
          year_month: string
        }
        Update: {
          branch_id?: number
          cantidad?: number
          descripcion?: string | null
          erp_product_id?: number
          neto?: number
          presentacion?: string
          ultima_venta?: string | null
          updated_at?: string
          year_month?: string
        }
        Relationships: []
      }
      product_sales_rollup: {
        Row: {
          analysis_days: number
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
          units_30d: number
          units_analysis: number
          updated_at: string
        }
        Insert: {
          analysis_days: number
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
          units_30d?: number
          units_analysis?: number
          updated_at?: string
        }
        Update: {
          analysis_days?: number
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
          units_30d?: number
          units_analysis?: number
          updated_at?: string
        }
        Relationships: []
      }
      product_stock_params: {
        Row: {
          abc_class: string | null
          ajuste_solicitud_id: number | null
          calc_max: number | null
          calc_min: number | null
          calculated_at: string | null
          cv: number | null
          daily_velocity: number | null
          data_days: number | null
          demand_variability: string | null
          draft_abc_class: string | null
          draft_calculated_at: string | null
          draft_cv: number | null
          draft_data_days: number | null
          draft_demand_variability: string | null
          draft_max: number | null
          draft_min: number | null
          draft_revenue: number | null
          draft_status: string
          draft_units_sold: number | null
          draft_velocity: number | null
          draft_velocity_30d: number | null
          erp_product_id: number
          erp_sucursal_id: number
          id: number
          is_hidden: boolean
          lead_time_days: number | null
          manual_at: string | null
          manual_cliente_dias: number | null
          manual_cliente_unidades: number | null
          manual_max: number | null
          manual_min: number | null
          manual_motivo: string | null
          manual_nota: string | null
          manual_por: string | null
          max_units: number | null
          min_units: number | null
          published_at: string | null
          published_by: string | null
          revenue_6m: number | null
          units_sold_6m: number | null
          updated_at: string | null
          velocity_30d: number | null
        }
        Insert: {
          abc_class?: string | null
          ajuste_solicitud_id?: number | null
          calc_max?: number | null
          calc_min?: number | null
          calculated_at?: string | null
          cv?: number | null
          daily_velocity?: number | null
          data_days?: number | null
          demand_variability?: string | null
          draft_abc_class?: string | null
          draft_calculated_at?: string | null
          draft_cv?: number | null
          draft_data_days?: number | null
          draft_demand_variability?: string | null
          draft_max?: number | null
          draft_min?: number | null
          draft_revenue?: number | null
          draft_status?: string
          draft_units_sold?: number | null
          draft_velocity?: number | null
          draft_velocity_30d?: number | null
          erp_product_id: number
          erp_sucursal_id: number
          id?: number
          is_hidden?: boolean
          lead_time_days?: number | null
          manual_at?: string | null
          manual_cliente_dias?: number | null
          manual_cliente_unidades?: number | null
          manual_max?: number | null
          manual_min?: number | null
          manual_motivo?: string | null
          manual_nota?: string | null
          manual_por?: string | null
          max_units?: number | null
          min_units?: number | null
          published_at?: string | null
          published_by?: string | null
          revenue_6m?: number | null
          units_sold_6m?: number | null
          updated_at?: string | null
          velocity_30d?: number | null
        }
        Update: {
          abc_class?: string | null
          ajuste_solicitud_id?: number | null
          calc_max?: number | null
          calc_min?: number | null
          calculated_at?: string | null
          cv?: number | null
          daily_velocity?: number | null
          data_days?: number | null
          demand_variability?: string | null
          draft_abc_class?: string | null
          draft_calculated_at?: string | null
          draft_cv?: number | null
          draft_data_days?: number | null
          draft_demand_variability?: string | null
          draft_max?: number | null
          draft_min?: number | null
          draft_revenue?: number | null
          draft_status?: string
          draft_units_sold?: number | null
          draft_velocity?: number | null
          draft_velocity_30d?: number | null
          erp_product_id?: number
          erp_sucursal_id?: number
          id?: number
          is_hidden?: boolean
          lead_time_days?: number | null
          manual_at?: string | null
          manual_cliente_dias?: number | null
          manual_cliente_unidades?: number | null
          manual_max?: number | null
          manual_min?: number | null
          manual_motivo?: string | null
          manual_nota?: string | null
          manual_por?: string | null
          max_units?: number | null
          min_units?: number | null
          published_at?: string | null
          published_by?: string | null
          revenue_6m?: number | null
          units_sold_6m?: number | null
          updated_at?: string | null
          velocity_30d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "psp_ajuste_solicitud_fk"
            columns: ["ajuste_solicitud_id"]
            isOneToOne: false
            referencedRelation: "minmax_change_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      product_stock_params_history: {
        Row: {
          abc_class: string | null
          calculated_at: string | null
          captured_at: string
          cv: number | null
          daily_velocity: number | null
          demand_variability: string | null
          erp_product_id: number
          erp_sucursal_id: number
          id: number
          max_units: number | null
          min_units: number | null
          velocity_30d: number | null
        }
        Insert: {
          abc_class?: string | null
          calculated_at?: string | null
          captured_at?: string
          cv?: number | null
          daily_velocity?: number | null
          demand_variability?: string | null
          erp_product_id: number
          erp_sucursal_id: number
          id?: number
          max_units?: number | null
          min_units?: number | null
          velocity_30d?: number | null
        }
        Update: {
          abc_class?: string | null
          calculated_at?: string | null
          captured_at?: string
          cv?: number | null
          daily_velocity?: number | null
          demand_variability?: string | null
          erp_product_id?: number
          erp_sucursal_id?: number
          id?: number
          max_units?: number | null
          min_units?: number | null
          velocity_30d?: number | null
        }
        Relationships: []
      }
      productos_sin_venta_avisados: {
        Row: {
          avisado_el: string
          created_at: string
          erp_product_id: number
          erp_sucursal_id: number
        }
        Insert: {
          avisado_el?: string
          created_at?: string
          erp_product_id: number
          erp_sucursal_id: number
        }
        Update: {
          avisado_el?: string
          created_at?: string
          erp_product_id?: number
          erp_sucursal_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "productos_sin_venta_avisados_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "productos_sin_venta_avisados_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          activo: boolean
          busq_todo: string | null
          codigo_barras: string | null
          created_at: string
          devolutivo: boolean
          es_antibiotico: boolean | null
          foto_url: string | null
          id: number
          laboratorio_id: number | null
          nombre: string
          nombre_busq: string | null
          nombre_comp: string | null
          nombre_norm: string | null
          oculto_at: string | null
          oculto_en_ventas: boolean
          oculto_por: string | null
          pactivo_busq: string | null
          pactivo_comp: string | null
          pactivo_norm: string | null
          perecedero: boolean | null
          principio_activo: string | null
          regulado: boolean | null
          requiere_receta: boolean
          sin_principio_activo: boolean
          tipo_medicamento: string | null
          updated_at: string | null
        }
        Insert: {
          activo?: boolean
          busq_todo?: string | null
          codigo_barras?: string | null
          created_at?: string
          devolutivo?: boolean
          es_antibiotico?: boolean | null
          foto_url?: string | null
          id: number
          laboratorio_id?: number | null
          nombre: string
          nombre_busq?: string | null
          nombre_comp?: string | null
          nombre_norm?: string | null
          oculto_at?: string | null
          oculto_en_ventas?: boolean
          oculto_por?: string | null
          pactivo_busq?: string | null
          pactivo_comp?: string | null
          pactivo_norm?: string | null
          perecedero?: boolean | null
          principio_activo?: string | null
          regulado?: boolean | null
          requiere_receta?: boolean
          sin_principio_activo?: boolean
          tipo_medicamento?: string | null
          updated_at?: string | null
        }
        Update: {
          activo?: boolean
          busq_todo?: string | null
          codigo_barras?: string | null
          created_at?: string
          devolutivo?: boolean
          es_antibiotico?: boolean | null
          foto_url?: string | null
          id?: number
          laboratorio_id?: number | null
          nombre?: string
          nombre_busq?: string | null
          nombre_comp?: string | null
          nombre_norm?: string | null
          oculto_at?: string | null
          oculto_en_ventas?: boolean
          oculto_por?: string | null
          pactivo_busq?: string | null
          pactivo_comp?: string | null
          pactivo_norm?: string | null
          perecedero?: boolean | null
          principio_activo?: string | null
          regulado?: boolean | null
          requiere_receta?: boolean
          sin_principio_activo?: boolean
          tipo_medicamento?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_laboratorio_id_fkey"
            columns: ["laboratorio_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_oculto_por_fkey"
            columns: ["oculto_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_oculto_por_fkey"
            columns: ["oculto_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      products_changelog: {
        Row: {
          campo: string
          detected_at: string
          id: number
          product_id: number
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Insert: {
          campo: string
          detected_at?: string
          id?: number
          product_id: number
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          campo?: string
          detected_at?: string
          id?: number
          product_id?: number
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_pc_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_pc_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      products_sync_log: {
        Row: {
          checked_at: string
          created_at: string
          error_msg: string | null
          id: number
          product_changes: number | null
          products_written: number | null
          success: boolean
        }
        Insert: {
          checked_at?: string
          created_at?: string
          error_msg?: string | null
          id?: number
          product_changes?: number | null
          products_written?: number | null
          success: boolean
        }
        Update: {
          checked_at?: string
          created_at?: string
          error_msg?: string | null
          id?: number
          product_changes?: number | null
          products_written?: number | null
          success?: boolean
        }
        Relationships: []
      }
      promocion_cierre_sala: {
        Row: {
          branch_id: number
          cerrado_at: string
          costo: number
          id: number
          monto_por_persona: number
          nivel: number | null
          personas: number
          promocion_id: number
          venta: number
        }
        Insert: {
          branch_id: number
          cerrado_at?: string
          costo?: number
          id?: never
          monto_por_persona?: number
          nivel?: number | null
          personas?: number
          promocion_id: number
          venta: number
        }
        Update: {
          branch_id?: number
          cerrado_at?: string
          costo?: number
          id?: never
          monto_por_persona?: number
          nivel?: number | null
          personas?: number
          promocion_id?: number
          venta?: number
        }
        Relationships: [
          {
            foreignKeyName: "promocion_cierre_sala_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_cierre_sala_promocion_id_fkey"
            columns: ["promocion_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_excedente: {
        Row: {
          branch_id: number | null
          created_at: string
          decidido_at: string | null
          decidido_por: string | null
          employee_id: string
          estado: string
          id: number
          monto: number
          motivo: string | null
          renglon_id: number
          unidades: number
        }
        Insert: {
          branch_id?: number | null
          created_at?: string
          decidido_at?: string | null
          decidido_por?: string | null
          employee_id: string
          estado?: string
          id?: never
          monto: number
          motivo?: string | null
          renglon_id: number
          unidades: number
        }
        Update: {
          branch_id?: number | null
          created_at?: string
          decidido_at?: string | null
          decidido_por?: string | null
          employee_id?: string
          estado?: string
          id?: never
          monto?: number
          motivo?: string | null
          renglon_id?: number
          unidades?: number
        }
        Relationships: [
          {
            foreignKeyName: "promocion_excedente_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_excedente_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_excedente_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_excedente_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_excedente_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_excedente_renglon_id_fkey"
            columns: ["renglon_id"]
            isOneToOne: false
            referencedRelation: "promocion_renglon"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_historial: {
        Row: {
          actor: string | null
          branch_id: number | null
          created_at: string
          evento: string
          id: number
          nota: string | null
          promocion_id: number | null
          renglon_id: number | null
          valor_antes: string | null
          valor_despues: string | null
        }
        Insert: {
          actor?: string | null
          branch_id?: number | null
          created_at?: string
          evento: string
          id?: never
          nota?: string | null
          promocion_id?: number | null
          renglon_id?: number | null
          valor_antes?: string | null
          valor_despues?: string | null
        }
        Update: {
          actor?: string | null
          branch_id?: number | null
          created_at?: string
          evento?: string
          id?: never
          nota?: string | null
          promocion_id?: number | null
          renglon_id?: number | null
          valor_antes?: string | null
          valor_despues?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promocion_historial_promocion_id_fkey"
            columns: ["promocion_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_historial_renglon_id_fkey"
            columns: ["renglon_id"]
            isOneToOne: false
            referencedRelation: "promocion_renglon"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_laboratorio: {
        Row: {
          created_at: string
          id: number
          laboratorio_id: number
          promocion_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          laboratorio_id: number
          promocion_id: number
        }
        Update: {
          created_at?: string
          id?: never
          laboratorio_id?: number
          promocion_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "promocion_laboratorio_laboratorio_id_fkey"
            columns: ["laboratorio_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_laboratorio_promocion_id_fkey"
            columns: ["promocion_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_nivel: {
        Row: {
          created_at: string
          id: number
          monto_por_persona: number
          nivel: number
          promocion_id: number
        }
        Insert: {
          created_at?: string
          id?: never
          monto_por_persona: number
          nivel: number
          promocion_id: number
        }
        Update: {
          created_at?: string
          id?: never
          monto_por_persona?: number
          nivel?: number
          promocion_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "promocion_nivel_promocion_id_fkey"
            columns: ["promocion_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_nivel_umbral: {
        Row: {
          branch_id: number
          created_at: string
          id: number
          nivel: number
          promocion_id: number
          umbral_venta: number
          updated_at: string
        }
        Insert: {
          branch_id: number
          created_at?: string
          id?: never
          nivel: number
          promocion_id: number
          umbral_venta: number
          updated_at?: string
        }
        Update: {
          branch_id?: number
          created_at?: string
          id?: never
          nivel?: number
          promocion_id?: number
          umbral_venta?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promocion_nivel_umbral_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_nivel_umbral_promocion_id_fkey"
            columns: ["promocion_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_pago: {
        Row: {
          branch_id: number
          clave_envio: string | null
          created_at: string
          employee_id: string | null
          estado: string
          excedente_id: number | null
          id: number
          item: string
          monto: number
          movimiento_id: number | null
          nota: string | null
          promocion_id: number
          reservado_por: string | null
          tipo: string
          updated_at: string
        }
        Insert: {
          branch_id: number
          clave_envio?: string | null
          created_at?: string
          employee_id?: string | null
          estado: string
          excedente_id?: number | null
          id?: never
          item: string
          monto: number
          movimiento_id?: number | null
          nota?: string | null
          promocion_id: number
          reservado_por?: string | null
          tipo: string
          updated_at?: string
        }
        Update: {
          branch_id?: number
          clave_envio?: string | null
          created_at?: string
          employee_id?: string | null
          estado?: string
          excedente_id?: number | null
          id?: never
          item?: string
          monto?: number
          movimiento_id?: number | null
          nota?: string | null
          promocion_id?: number
          reservado_por?: string | null
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promocion_pago_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_pago_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_pago_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_pago_excedente_id_fkey"
            columns: ["excedente_id"]
            isOneToOne: false
            referencedRelation: "promocion_excedente"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_pago_movimiento_id_fkey"
            columns: ["movimiento_id"]
            isOneToOne: false
            referencedRelation: "caja_movimientos_portal"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_pago_promocion_id_fkey"
            columns: ["promocion_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_pago_reservado_por_fkey"
            columns: ["reservado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_pago_reservado_por_fkey"
            columns: ["reservado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_renglon: {
        Row: {
          cerrado_at: string | null
          cerrado_motivo: string | null
          created_at: string
          erp_product_id: number
          estado: string
          factor_unidades: number | null
          fin: string
          id: number
          inicio: string
          lote_total: number | null
          paga: string | null
          promocion_id: number
          supplier_id: number | null
          tiene_bono: boolean
          updated_at: string
        }
        Insert: {
          cerrado_at?: string | null
          cerrado_motivo?: string | null
          created_at?: string
          erp_product_id: number
          estado?: string
          factor_unidades?: number | null
          fin: string
          id?: never
          inicio: string
          lote_total?: number | null
          paga?: string | null
          promocion_id: number
          supplier_id?: number | null
          tiene_bono?: boolean
          updated_at?: string
        }
        Update: {
          cerrado_at?: string | null
          cerrado_motivo?: string | null
          created_at?: string
          erp_product_id?: number
          estado?: string
          factor_unidades?: number | null
          fin?: string
          id?: never
          inicio?: string
          lote_total?: number | null
          paga?: string | null
          promocion_id?: number
          supplier_id?: number | null
          tiene_bono?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promocion_renglon_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_renglon_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_renglon_promocion_id_fkey"
            columns: ["promocion_id"]
            isOneToOne: false
            referencedRelation: "promociones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_renglon_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_renglon_tarifa: {
        Row: {
          bono_adm: number
          bono_bodega: number
          bono_vendedor: number
          creado_por: string | null
          created_at: string
          desde: string
          id: number
          renglon_id: number
          unidades_por_bono: number
        }
        Insert: {
          bono_adm?: number
          bono_bodega?: number
          bono_vendedor?: number
          creado_por?: string | null
          created_at?: string
          desde: string
          id?: never
          renglon_id: number
          unidades_por_bono?: number
        }
        Update: {
          bono_adm?: number
          bono_bodega?: number
          bono_vendedor?: number
          creado_por?: string | null
          created_at?: string
          desde?: string
          id?: never
          renglon_id?: number
          unidades_por_bono?: number
        }
        Relationships: [
          {
            foreignKeyName: "promocion_renglon_tarifa_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_renglon_tarifa_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_renglon_tarifa_renglon_id_fkey"
            columns: ["renglon_id"]
            isOneToOne: false
            referencedRelation: "promocion_renglon"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_reparto: {
        Row: {
          asignado_original: number
          asignado_vigente: number
          avisado_100_at: string | null
          avisado_80_at: string | null
          branch_id: number
          created_at: string
          id: number
          renglon_id: number
          updated_at: string
        }
        Insert: {
          asignado_original: number
          asignado_vigente: number
          avisado_100_at?: string | null
          avisado_80_at?: string | null
          branch_id: number
          created_at?: string
          id?: never
          renglon_id: number
          updated_at?: string
        }
        Update: {
          asignado_original?: number
          asignado_vigente?: number
          avisado_100_at?: string | null
          avisado_80_at?: string | null
          branch_id?: number
          created_at?: string
          id?: never
          renglon_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promocion_reparto_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_reparto_renglon_id_fkey"
            columns: ["renglon_id"]
            isOneToOne: false
            referencedRelation: "promocion_renglon"
            referencedColumns: ["id"]
          },
        ]
      }
      promocion_reparto_mov: {
        Row: {
          branch_id_destino: number | null
          branch_id_origen: number | null
          circuito: string
          created_at: string
          id: number
          movido_por: string | null
          origen_ref: string | null
          renglon_id: number
          unidades: number
        }
        Insert: {
          branch_id_destino?: number | null
          branch_id_origen?: number | null
          circuito: string
          created_at?: string
          id?: never
          movido_por?: string | null
          origen_ref?: string | null
          renglon_id: number
          unidades: number
        }
        Update: {
          branch_id_destino?: number | null
          branch_id_origen?: number | null
          circuito?: string
          created_at?: string
          id?: never
          movido_por?: string | null
          origen_ref?: string | null
          renglon_id?: number
          unidades?: number
        }
        Relationships: [
          {
            foreignKeyName: "promocion_reparto_mov_branch_id_destino_fkey"
            columns: ["branch_id_destino"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_reparto_mov_branch_id_origen_fkey"
            columns: ["branch_id_origen"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_reparto_mov_movido_por_fkey"
            columns: ["movido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_reparto_mov_movido_por_fkey"
            columns: ["movido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promocion_reparto_mov_renglon_id_fkey"
            columns: ["renglon_id"]
            isOneToOne: false
            referencedRelation: "promocion_renglon"
            referencedColumns: ["id"]
          },
        ]
      }
      promociones: {
        Row: {
          creado_por: string | null
          created_at: string
          descuentos_erp: number[]
          estado: string
          id: number
          nombre: string
          nota: string | null
          paga: string | null
          resumen_salas: boolean
          resumen_supervision: boolean
          supplier_id: number | null
          tipo: string
          updated_at: string
          year_month: string | null
        }
        Insert: {
          creado_por?: string | null
          created_at?: string
          descuentos_erp?: number[]
          estado?: string
          id?: never
          nombre: string
          nota?: string | null
          paga?: string | null
          resumen_salas?: boolean
          resumen_supervision?: boolean
          supplier_id?: number | null
          tipo?: string
          updated_at?: string
          year_month?: string | null
        }
        Update: {
          creado_por?: string | null
          created_at?: string
          descuentos_erp?: number[]
          estado?: string
          id?: never
          nombre?: string
          nota?: string | null
          paga?: string | null
          resumen_salas?: boolean
          resumen_supervision?: boolean
          supplier_id?: number | null
          tipo?: string
          updated_at?: string
          year_month?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promociones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promociones_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promociones_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      proveedores: {
        Row: {
          created_at: string
          devolutivo: boolean
          id: number
          laboratorio_id: number
          meses_devolucion: number | null
          nombre: string
          notas: string | null
          updated_at: string
          vineta: number | null
        }
        Insert: {
          created_at?: string
          devolutivo?: boolean
          id?: number
          laboratorio_id: number
          meses_devolucion?: number | null
          nombre: string
          notas?: string | null
          updated_at?: string
          vineta?: number | null
        }
        Update: {
          created_at?: string
          devolutivo?: boolean
          id?: number
          laboratorio_id?: number
          meses_devolucion?: number | null
          nombre?: string
          notas?: string | null
          updated_at?: string
          vineta?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_laboratorio_id_fkey"
            columns: ["laboratorio_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
        ]
      }
      proveedores_categorias: {
        Row: {
          clase: string
          created_at: string
          id: number
          nombre: string
        }
        Insert: {
          clase: string
          created_at?: string
          id?: never
          nombre: string
        }
        Update: {
          clase?: string
          created_at?: string
          id?: never
          nombre?: string
        }
        Relationships: []
      }
      proveedores_maestro: {
        Row: {
          activo: boolean
          alias: string | null
          categoria_id: number | null
          clasificacion_base_legal: string | null
          clasificacion_estado: string
          clasificacion_nota: string | null
          clasificado_at: string | null
          clasificado_por: string | null
          cod_actividad: string | null
          contacto_nombre: string | null
          correo: string | null
          created_at: string
          departamento: string | null
          desc_actividad: string | null
          dias_credito: number | null
          direccion: string | null
          docs_count: number
          dui: string | null
          f07_clasificacion: number | null
          f07_sector: number | null
          f07_tipo_costo_gasto: number | null
          f07_tipo_operacion: number | null
          forma_pago: string | null
          id: number
          iva_deducible: boolean | null
          limite_credito: number | null
          municipio: string | null
          nit: string | null
          nombre: string
          nombre_cheques: string | null
          nombre_comercial: string | null
          nombre_norm: string | null
          notas: string | null
          nrc: string | null
          pais: string
          percibe_1: boolean
          percibe_1_override: boolean | null
          primera_vez_visto: string | null
          retiene_renta: boolean
          source: string
          supplier_id: number | null
          telefono: string | null
          telefono2: string | null
          tipo_establecimiento: string | null
          ultima_vez_visto: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          alias?: string | null
          categoria_id?: number | null
          clasificacion_base_legal?: string | null
          clasificacion_estado?: string
          clasificacion_nota?: string | null
          clasificado_at?: string | null
          clasificado_por?: string | null
          cod_actividad?: string | null
          contacto_nombre?: string | null
          correo?: string | null
          created_at?: string
          departamento?: string | null
          desc_actividad?: string | null
          dias_credito?: number | null
          direccion?: string | null
          docs_count?: number
          dui?: string | null
          f07_clasificacion?: number | null
          f07_sector?: number | null
          f07_tipo_costo_gasto?: number | null
          f07_tipo_operacion?: number | null
          forma_pago?: string | null
          id?: never
          iva_deducible?: boolean | null
          limite_credito?: number | null
          municipio?: string | null
          nit?: string | null
          nombre: string
          nombre_cheques?: string | null
          nombre_comercial?: string | null
          nombre_norm?: string | null
          notas?: string | null
          nrc?: string | null
          pais?: string
          percibe_1?: boolean
          percibe_1_override?: boolean | null
          primera_vez_visto?: string | null
          retiene_renta?: boolean
          source?: string
          supplier_id?: number | null
          telefono?: string | null
          telefono2?: string | null
          tipo_establecimiento?: string | null
          ultima_vez_visto?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          alias?: string | null
          categoria_id?: number | null
          clasificacion_base_legal?: string | null
          clasificacion_estado?: string
          clasificacion_nota?: string | null
          clasificado_at?: string | null
          clasificado_por?: string | null
          cod_actividad?: string | null
          contacto_nombre?: string | null
          correo?: string | null
          created_at?: string
          departamento?: string | null
          desc_actividad?: string | null
          dias_credito?: number | null
          direccion?: string | null
          docs_count?: number
          dui?: string | null
          f07_clasificacion?: number | null
          f07_sector?: number | null
          f07_tipo_costo_gasto?: number | null
          f07_tipo_operacion?: number | null
          forma_pago?: string | null
          id?: never
          iva_deducible?: boolean | null
          limite_credito?: number | null
          municipio?: string | null
          nit?: string | null
          nombre?: string
          nombre_cheques?: string | null
          nombre_comercial?: string | null
          nombre_norm?: string | null
          notas?: string | null
          nrc?: string | null
          pais?: string
          percibe_1?: boolean
          percibe_1_override?: boolean | null
          primera_vez_visto?: string | null
          retiene_renta?: boolean
          source?: string
          supplier_id?: number | null
          telefono?: string | null
          telefono2?: string | null
          tipo_establecimiento?: string | null
          ultima_vez_visto?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proveedores_maestro_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "proveedores_categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedores_maestro_clasificado_por_fkey"
            columns: ["clasificado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedores_maestro_clasificado_por_fkey"
            columns: ["clasificado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proveedores_maestro_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_anulacion_gastada: {
        Row: {
          created_at: string
          customer_id: number
          dio: number
          invoice_id: number
          no_recuperados: number
          sucursal: string | null
        }
        Insert: {
          created_at?: string
          customer_id: number
          dio: number
          invoice_id: number
          no_recuperados: number
          sucursal?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: number
          dio?: number
          invoice_id?: number
          no_recuperados?: number
          sucursal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "puntos_anulacion_gastada_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_anulacion_gastada_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      puntos_archivo_canje: {
        Row: {
          carga_id: number
          created_at: string
          datos: Json
          fecha: string
          id_canje: number
          id_cliente: number
          puntos: number
          sucursal: string | null
          ticket: string | null
        }
        Insert: {
          carga_id: number
          created_at?: string
          datos: Json
          fecha: string
          id_canje: number
          id_cliente: number
          puntos: number
          sucursal?: string | null
          ticket?: string | null
        }
        Update: {
          carga_id?: number
          created_at?: string
          datos?: Json
          fecha?: string
          id_canje?: number
          id_cliente?: number
          puntos?: number
          sucursal?: string | null
          ticket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "puntos_archivo_canje_carga_id_fkey"
            columns: ["carga_id"]
            isOneToOne: false
            referencedRelation: "puntos_archivo_carga"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_archivo_carga: {
        Row: {
          completa: boolean
          created_at: string
          id: number
          mysql_canjes: number | null
          mysql_clientes: number | null
          mysql_ventas: number | null
          terminada_at: string | null
        }
        Insert: {
          completa?: boolean
          created_at?: string
          id?: number
          mysql_canjes?: number | null
          mysql_clientes?: number | null
          mysql_ventas?: number | null
          terminada_at?: string | null
        }
        Update: {
          completa?: boolean
          created_at?: string
          id?: number
          mysql_canjes?: number | null
          mysql_clientes?: number | null
          mysql_ventas?: number | null
          terminada_at?: string | null
        }
        Relationships: []
      }
      puntos_archivo_cliente: {
        Row: {
          asignada_a: number | null
          asignada_at: string | null
          asignada_como: string | null
          asignada_nota: string | null
          asignada_por: string | null
          carga_id: number
          created_at: string
          datos: Json
          dui: string | null
          id_cliente: number
          puntos: number
        }
        Insert: {
          asignada_a?: number | null
          asignada_at?: string | null
          asignada_como?: string | null
          asignada_nota?: string | null
          asignada_por?: string | null
          carga_id: number
          created_at?: string
          datos: Json
          dui?: string | null
          id_cliente: number
          puntos?: number
        }
        Update: {
          asignada_a?: number | null
          asignada_at?: string | null
          asignada_como?: string | null
          asignada_nota?: string | null
          asignada_por?: string | null
          carga_id?: number
          created_at?: string
          datos?: Json
          dui?: string | null
          id_cliente?: number
          puntos?: number
        }
        Relationships: [
          {
            foreignKeyName: "puntos_archivo_cliente_carga_id_fkey"
            columns: ["carga_id"]
            isOneToOne: false
            referencedRelation: "puntos_archivo_carga"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_archivo_venta: {
        Row: {
          carga_id: number
          created_at: string
          datos: Json
          fecha: string
          id_cliente: number
          id_venta: number
          puntos: number
          sucursal: string | null
          ticket: string | null
        }
        Insert: {
          carga_id: number
          created_at?: string
          datos: Json
          fecha: string
          id_cliente: number
          id_venta: number
          puntos: number
          sucursal?: string | null
          ticket?: string | null
        }
        Update: {
          carga_id?: number
          created_at?: string
          datos?: Json
          fecha?: string
          id_cliente?: number
          id_venta?: number
          puntos?: number
          sucursal?: string | null
          ticket?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "puntos_archivo_venta_carga_id_fkey"
            columns: ["carga_id"]
            isOneToOne: false
            referencedRelation: "puntos_archivo_carga"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_arranque: {
        Row: {
          created_at: string
          encendido: boolean
          id: number
          ok: boolean
          resultado: Json
          simulado: boolean
        }
        Insert: {
          created_at?: string
          encendido?: boolean
          id?: number
          ok: boolean
          resultado: Json
          simulado: boolean
        }
        Update: {
          created_at?: string
          encendido?: boolean
          id?: number
          ok?: boolean
          resultado?: Json
          simulado?: boolean
        }
        Relationships: []
      }
      puntos_codigo_acceso: {
        Row: {
          codigo: string
          created_at: string
          customer_id: number
          emitido_at: string
          emitido_por: string | null
          veces_emitido: number
        }
        Insert: {
          codigo: string
          created_at?: string
          customer_id: number
          emitido_at?: string
          emitido_por?: string | null
          veces_emitido?: number
        }
        Update: {
          codigo?: string
          created_at?: string
          customer_id?: number
          emitido_at?: string
          emitido_por?: string | null
          veces_emitido?: number
        }
        Relationships: [
          {
            foreignKeyName: "puntos_codigo_acceso_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_codigo_acceso_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "puntos_codigo_acceso_emitido_por_fkey"
            columns: ["emitido_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_codigo_acceso_emitido_por_fkey"
            columns: ["emitido_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_config: {
        Row: {
          acumulacion_activa: boolean
          fuente: string
          id: boolean
          inicio: string | null
          minimo_canje: number
          nota: string | null
          puntos_cumpleanos: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acumulacion_activa?: boolean
          fuente?: string
          id?: boolean
          inicio?: string | null
          minimo_canje?: number
          nota?: string | null
          puntos_cumpleanos?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acumulacion_activa?: boolean
          fuente?: string
          id?: boolean
          inicio?: string | null
          minimo_canje?: number
          nota?: string | null
          puntos_cumpleanos?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "puntos_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_consulta_intentos: {
        Row: {
          acerto: boolean
          created_at: string
          huella_dui: string | null
          id: number
          ip: string
        }
        Insert: {
          acerto?: boolean
          created_at?: string
          huella_dui?: string | null
          id?: number
          ip: string
        }
        Update: {
          acerto?: boolean
          created_at?: string
          huella_dui?: string | null
          id?: number
          ip?: string
        }
        Relationships: []
      }
      puntos_cuenta: {
        Row: {
          activa: boolean
          created_at: string
          customer_id: number
          ganados: number
          migrada_at: string | null
          saldo: number
          updated_at: string
          usados: number
        }
        Insert: {
          activa?: boolean
          created_at?: string
          customer_id: number
          ganados?: number
          migrada_at?: string | null
          saldo?: number
          updated_at?: string
          usados?: number
        }
        Update: {
          activa?: boolean
          created_at?: string
          customer_id?: number
          ganados?: number
          migrada_at?: string | null
          saldo?: number
          updated_at?: string
          usados?: number
        }
        Relationships: [
          {
            foreignKeyName: "puntos_cuenta_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_cuenta_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: true
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      puntos_enviados: {
        Row: {
          anulada_at: string | null
          aplicado: number | null
          avisada_at: string | null
          cliente: string | null
          cod_vendedor: number | null
          correlativo: string | null
          created_at: string
          enviado_at: string
          erp_invoice_id: string
          estado_anulada: string | null
          estado_puntos: string | null
          fecha: string
          invoice_id: number
          puntos_devueltos: number | null
          puntos_no_recuperados: number | null
          reversion: string | null
          revertida_at: string | null
          sucursal: string
          total: number
          visto_at: string | null
        }
        Insert: {
          anulada_at?: string | null
          aplicado?: number | null
          avisada_at?: string | null
          cliente?: string | null
          cod_vendedor?: number | null
          correlativo?: string | null
          created_at?: string
          enviado_at?: string
          erp_invoice_id: string
          estado_anulada?: string | null
          estado_puntos?: string | null
          fecha: string
          invoice_id: number
          puntos_devueltos?: number | null
          puntos_no_recuperados?: number | null
          reversion?: string | null
          revertida_at?: string | null
          sucursal: string
          total: number
          visto_at?: string | null
        }
        Update: {
          anulada_at?: string | null
          aplicado?: number | null
          avisada_at?: string | null
          cliente?: string | null
          cod_vendedor?: number | null
          correlativo?: string | null
          created_at?: string
          enviado_at?: string
          erp_invoice_id?: string
          estado_anulada?: string | null
          estado_puntos?: string | null
          fecha?: string
          invoice_id?: number
          puntos_devueltos?: number | null
          puntos_no_recuperados?: number | null
          reversion?: string | null
          revertida_at?: string | null
          sucursal?: string
          total?: number
          visto_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "puntos_enviados_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_enviados_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_enviados_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      puntos_lote: {
        Row: {
          creado_por: string | null
          created_at: string
          cuenta_anterior: number | null
          customer_id: number
          ganado_el: string
          id: number
          invoice_id: number | null
          motivo: string | null
          origen: string
          puntos: number
          ref_anterior: number | null
          restantes: number
          sucursal: string | null
          vence_el: string
        }
        Insert: {
          creado_por?: string | null
          created_at?: string
          cuenta_anterior?: number | null
          customer_id: number
          ganado_el: string
          id?: number
          invoice_id?: number | null
          motivo?: string | null
          origen: string
          puntos: number
          ref_anterior?: number | null
          restantes: number
          sucursal?: string | null
          vence_el: string
        }
        Update: {
          creado_por?: string | null
          created_at?: string
          cuenta_anterior?: number | null
          customer_id?: number
          ganado_el?: string
          id?: number
          invoice_id?: number | null
          motivo?: string | null
          origen?: string
          puntos?: number
          ref_anterior?: number | null
          restantes?: number
          sucursal?: string | null
          vence_el?: string
        }
        Relationships: [
          {
            foreignKeyName: "puntos_lote_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_lote_creado_por_fkey"
            columns: ["creado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_lote_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_lote_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "puntos_lote_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_lote_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_lote_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      puntos_producto_no_acumula: {
        Row: {
          created_at: string
          motivo: string
          product_id: number
        }
        Insert: {
          created_at?: string
          motivo: string
          product_id: number
        }
        Update: {
          created_at?: string
          motivo?: string
          product_id?: number
        }
        Relationships: []
      }
      puntos_salida: {
        Row: {
          autorizado_por: string | null
          created_at: string
          cuenta_anterior: number | null
          customer_id: number
          id: number
          invoice_id: number | null
          monto: number | null
          motivo: string | null
          puntos: number
          ref_anterior: number | null
          revertida_at: string | null
          sucursal: string | null
          tipo: string
        }
        Insert: {
          autorizado_por?: string | null
          created_at?: string
          cuenta_anterior?: number | null
          customer_id: number
          id?: number
          invoice_id?: number | null
          monto?: number | null
          motivo?: string | null
          puntos: number
          ref_anterior?: number | null
          revertida_at?: string | null
          sucursal?: string | null
          tipo: string
        }
        Update: {
          autorizado_por?: string | null
          created_at?: string
          cuenta_anterior?: number | null
          customer_id?: number
          id?: number
          invoice_id?: number | null
          monto?: number | null
          motivo?: string | null
          puntos?: number
          ref_anterior?: number | null
          revertida_at?: string | null
          sucursal?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "puntos_salida_autorizado_por_fkey"
            columns: ["autorizado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_salida_autorizado_por_fkey"
            columns: ["autorizado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_salida_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_salida_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "puntos_salida_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_salida_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_salida_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      puntos_salida_lote: {
        Row: {
          lote_id: number
          puntos: number
          salida_id: number
        }
        Insert: {
          lote_id: number
          puntos: number
          salida_id: number
        }
        Update: {
          lote_id?: number
          puntos?: number
          salida_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "puntos_salida_lote_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "puntos_lote"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "puntos_salida_lote_salida_id_fkey"
            columns: ["salida_id"]
            isOneToOne: false
            referencedRelation: "puntos_salida"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_vencimiento_log: {
        Row: {
          clientes: number
          clientes_sin_gracia: number
          created_at: string
          descuadrados: number
          detalle: Json | null
          evaluado_al: string
          id: number
          ms: number | null
          puntos: number
          puntos_sin_gracia: number
          simulado: boolean
        }
        Insert: {
          clientes?: number
          clientes_sin_gracia?: number
          created_at?: string
          descuadrados?: number
          detalle?: Json | null
          evaluado_al: string
          id?: number
          ms?: number | null
          puntos?: number
          puntos_sin_gracia?: number
          simulado?: boolean
        }
        Update: {
          clientes?: number
          clientes_sin_gracia?: number
          created_at?: string
          descuadrados?: number
          detalle?: Json | null
          evaluado_al?: string
          id?: number
          ms?: number | null
          puntos?: number
          puntos_sin_gracia?: number
          simulado?: boolean
        }
        Relationships: []
      }
      purchase_claim_avisos: {
        Row: {
          avisado_at: string
          branch_id: number
          created_at: string
          destinatarios: number
          document_id: number
        }
        Insert: {
          avisado_at?: string
          branch_id: number
          created_at?: string
          destinatarios?: number
          document_id: number
        }
        Update: {
          avisado_at?: string
          branch_id?: number
          created_at?: string
          destinatarios?: number
          document_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_claim_avisos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_claim_avisos_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "compra_deuda_documentos"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "purchase_claim_avisos_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "purchase_dte_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_claim_lines: {
        Row: {
          branch_id: number
          created_at: string
          id: number
          linea: string
          nota: string | null
          rule_id: number
        }
        Insert: {
          branch_id: number
          created_at?: string
          id?: never
          linea: string
          nota?: string | null
          rule_id: number
        }
        Update: {
          branch_id?: number
          created_at?: string
          id?: never
          linea?: string
          nota?: string | null
          rule_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_claim_lines_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_claim_lines_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "purchase_claim_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_claim_rules: {
        Row: {
          activo: boolean
          asignacion: string
          created_at: string
          emisor_nit: string | null
          etiqueta: string
          id: number
          item_patron: string | null
          notas: string | null
          orden: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          asignacion?: string
          created_at?: string
          emisor_nit?: string | null
          etiqueta: string
          id?: never
          item_patron?: string | null
          notas?: string | null
          orden?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          asignacion?: string
          created_at?: string
          emisor_nit?: string | null
          etiqueta?: string
          id?: never
          item_patron?: string | null
          notas?: string | null
          orden?: number
          updated_at?: string
        }
        Relationships: []
      }
      purchase_dte_claims: {
        Row: {
          branch_id: number
          claimed_at: string
          claimed_by: string | null
          claimed_by_name: string | null
          created_at: string
          document_id: number
          id: number
          origen: string
          receipt_id: number | null
          released_at: string | null
          released_by: string | null
          released_motivo: string | null
          rule_id: number | null
          verificado_at: string | null
        }
        Insert: {
          branch_id: number
          claimed_at?: string
          claimed_by?: string | null
          claimed_by_name?: string | null
          created_at?: string
          document_id: number
          id?: never
          origen?: string
          receipt_id?: number | null
          released_at?: string | null
          released_by?: string | null
          released_motivo?: string | null
          rule_id?: number | null
          verificado_at?: string | null
        }
        Update: {
          branch_id?: number
          claimed_at?: string
          claimed_by?: string | null
          claimed_by_name?: string | null
          created_at?: string
          document_id?: number
          id?: never
          origen?: string
          receipt_id?: number | null
          released_at?: string | null
          released_by?: string | null
          released_motivo?: string | null
          rule_id?: number | null
          verificado_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_dte_claims_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "compra_deuda_documentos"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "purchase_dte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_claims_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "purchase_claim_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_dte_documents: {
        Row: {
          account_id: number
          codigo_generacion: string | null
          corrige_purchase_receipt_id: number | null
          created_at: string
          doc_relacionado_ref: string | null
          documento_relacionado_id: number | null
          emisor_nit: string | null
          emisor_nombre: string | null
          emisor_nrc: string | null
          fecha_emision: string | null
          from_email: string | null
          id: number
          invalidado: boolean
          invalidado_at: string | null
          invalidado_motivo: string | null
          items_norm: string | null
          items_text: string | null
          json_path: string | null
          monto_total: number | null
          numero_control: string | null
          orig_json_path: string | null
          pdf_path: string | null
          proveedor_id: number | null
          received_at: string | null
          sello_recibido: string | null
          source_message_id: string | null
          supplier_id: number | null
          tipo_dte: string | null
          total_iva: number | null
        }
        Insert: {
          account_id: number
          codigo_generacion?: string | null
          corrige_purchase_receipt_id?: number | null
          created_at?: string
          doc_relacionado_ref?: string | null
          documento_relacionado_id?: number | null
          emisor_nit?: string | null
          emisor_nombre?: string | null
          emisor_nrc?: string | null
          fecha_emision?: string | null
          from_email?: string | null
          id?: never
          invalidado?: boolean
          invalidado_at?: string | null
          invalidado_motivo?: string | null
          items_norm?: string | null
          items_text?: string | null
          json_path?: string | null
          monto_total?: number | null
          numero_control?: string | null
          orig_json_path?: string | null
          pdf_path?: string | null
          proveedor_id?: number | null
          received_at?: string | null
          sello_recibido?: string | null
          source_message_id?: string | null
          supplier_id?: number | null
          tipo_dte?: string | null
          total_iva?: number | null
        }
        Update: {
          account_id?: number
          codigo_generacion?: string | null
          corrige_purchase_receipt_id?: number | null
          created_at?: string
          doc_relacionado_ref?: string | null
          documento_relacionado_id?: number | null
          emisor_nit?: string | null
          emisor_nombre?: string | null
          emisor_nrc?: string | null
          fecha_emision?: string | null
          from_email?: string | null
          id?: never
          invalidado?: boolean
          invalidado_at?: string | null
          invalidado_motivo?: string | null
          items_norm?: string | null
          items_text?: string | null
          json_path?: string | null
          monto_total?: number | null
          numero_control?: string | null
          orig_json_path?: string | null
          pdf_path?: string | null
          proveedor_id?: number | null
          received_at?: string | null
          sello_recibido?: string | null
          source_message_id?: string | null
          supplier_id?: number | null
          tipo_dte?: string | null
          total_iva?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_dte_documents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_sync_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_documents_corrige_purchase_receipt_id_fkey"
            columns: ["corrige_purchase_receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_documents_documento_relacionado_id_fkey"
            columns: ["documento_relacionado_id"]
            isOneToOne: false
            referencedRelation: "compra_deuda_documentos"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "purchase_dte_documents_documento_relacionado_id_fkey"
            columns: ["documento_relacionado_id"]
            isOneToOne: false
            referencedRelation: "purchase_dte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_documents_proveedor_id_fkey"
            columns: ["proveedor_id"]
            isOneToOne: false
            referencedRelation: "proveedores_maestro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_documents_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_dte_processed_messages: {
        Row: {
          account_id: number
          id: number
          processed_at: string
          source_message_id: string
        }
        Insert: {
          account_id: number
          id?: never
          processed_at?: string
          source_message_id: string
        }
        Update: {
          account_id?: number
          id?: never
          processed_at?: string
          source_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_dte_processed_messages_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_sync_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_dte_review_queue: {
        Row: {
          account_id: number
          ai_suggested: Json | null
          created_at: string
          file_path: string
          filename: string | null
          from_email: string | null
          id: number
          kind: string
          matched_document_id: number | null
          reason: string | null
          received_at: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_message_id: string | null
          status: string
          subject: string | null
        }
        Insert: {
          account_id: number
          ai_suggested?: Json | null
          created_at?: string
          file_path: string
          filename?: string | null
          from_email?: string | null
          id?: never
          kind: string
          matched_document_id?: number | null
          reason?: string | null
          received_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_message_id?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          account_id?: number
          ai_suggested?: Json | null
          created_at?: string
          file_path?: string
          filename?: string | null
          from_email?: string | null
          id?: never
          kind?: string
          matched_document_id?: number | null
          reason?: string | null
          received_at?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_message_id?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_dte_review_queue_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "email_sync_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_review_queue_matched_document_id_fkey"
            columns: ["matched_document_id"]
            isOneToOne: false
            referencedRelation: "compra_deuda_documentos"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "purchase_dte_review_queue_matched_document_id_fkey"
            columns: ["matched_document_id"]
            isOneToOne: false
            referencedRelation: "purchase_dte_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_review_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_dte_review_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipt_items: {
        Row: {
          cantidad: number | null
          descripcion: string | null
          erp_product_id: number | null
          fecha_vencimiento: string | null
          id: number
          linea_num: number
          lote: string | null
          precio_unitario: number | null
          receipt_id: number
          total_linea: number | null
        }
        Insert: {
          cantidad?: number | null
          descripcion?: string | null
          erp_product_id?: number | null
          fecha_vencimiento?: string | null
          id?: number
          linea_num: number
          lote?: string | null
          precio_unitario?: number | null
          receipt_id: number
          total_linea?: number | null
        }
        Update: {
          cantidad?: number | null
          descripcion?: string | null
          erp_product_id?: number | null
          fecha_vencimiento?: string | null
          id?: number
          linea_num?: number
          lote?: string | null
          precio_unitario?: number | null
          receipt_id?: number
          total_linea?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "purchase_receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_receipts: {
        Row: {
          branch_id: number
          documento_numero: string | null
          documento_tipo: string | null
          erp_purchase_id: number
          erp_sucursal_id: number
          erp_supplier_id: number | null
          estado: string | null
          fecha: string
          id: number
          iva: number | null
          percepcion_iva: number | null
          proveedor: string | null
          retencion_iva: number | null
          sello_recibido: string | null
          subtotal: number | null
          supplier_id: number | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          branch_id: number
          documento_numero?: string | null
          documento_tipo?: string | null
          erp_purchase_id: number
          erp_sucursal_id: number
          erp_supplier_id?: number | null
          estado?: string | null
          fecha: string
          id?: number
          iva?: number | null
          percepcion_iva?: number | null
          proveedor?: string | null
          retencion_iva?: number | null
          sello_recibido?: string | null
          subtotal?: number | null
          supplier_id?: number | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: number
          documento_numero?: string | null
          documento_tipo?: string | null
          erp_purchase_id?: number
          erp_sucursal_id?: number
          erp_supplier_id?: number | null
          estado?: string | null
          fecha?: string
          id?: number
          iva?: number | null
          percepcion_iva?: number | null
          proveedor?: string | null
          retencion_iva?: number | null
          sello_recibido?: string | null
          subtotal?: number | null
          supplier_id?: number | null
          total?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_sync_log: {
        Row: {
          branch_id: number | null
          erp_sucursal_id: number | null
          error_msg: string | null
          ffin: string | null
          fini: string | null
          id: number
          items_inserted: number | null
          receipts_new: number | null
          receipts_total: number | null
          success: boolean | null
          synced_at: string | null
        }
        Insert: {
          branch_id?: number | null
          erp_sucursal_id?: number | null
          error_msg?: string | null
          ffin?: string | null
          fini?: string | null
          id?: number
          items_inserted?: number | null
          receipts_new?: number | null
          receipts_total?: number | null
          success?: boolean | null
          synced_at?: string | null
        }
        Update: {
          branch_id?: number | null
          erp_sucursal_id?: number | null
          error_msg?: string | null
          ffin?: string | null
          fini?: string | null
          id?: number
          items_inserted?: number | null
          receipts_new?: number | null
          receipts_total?: number | null
          success?: boolean | null
          synced_at?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          employee_id: string
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
        }
        Insert: {
          auth: string
          created_at?: string
          employee_id: string
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
        }
        Update: {
          auth?: string
          created_at?: string
          employee_id?: string
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      receta_items: {
        Row: {
          cantidad_prescrita: number
          created_at: string
          descripcion: string
          erp_product_id: number | null
          forma_farmaceutica: string | null
          id: number
          receta_id: number
        }
        Insert: {
          cantidad_prescrita: number
          created_at?: string
          descripcion: string
          erp_product_id?: number | null
          forma_farmaceutica?: string | null
          id?: never
          receta_id: number
        }
        Update: {
          cantidad_prescrita?: number
          created_at?: string
          descripcion?: string
          erp_product_id?: number | null
          forma_farmaceutica?: string | null
          id?: never
          receta_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "receta_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receta_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receta_items_receta_id_fkey"
            columns: ["receta_id"]
            isOneToOne: false
            referencedRelation: "recetas"
            referencedColumns: ["id"]
          },
        ]
      }
      recetas: {
        Row: {
          anio: number
          anulada_at: string | null
          anulada_por: string | null
          branch_id: number
          correlativo: number
          creada_por: string
          created_at: string
          estado: string
          fecha_prescripcion: string | null
          foto_url: string | null
          id: number
          medico_id: number | null
          motivo_anulacion: string | null
          motivo_pendiente: string | null
          notas: string | null
          paciente_documento: string | null
          paciente_edad: number | null
          paciente_nombre: string | null
          updated_at: string
        }
        Insert: {
          anio: number
          anulada_at?: string | null
          anulada_por?: string | null
          branch_id: number
          correlativo: number
          creada_por: string
          created_at?: string
          estado?: string
          fecha_prescripcion?: string | null
          foto_url?: string | null
          id?: never
          medico_id?: number | null
          motivo_anulacion?: string | null
          motivo_pendiente?: string | null
          notas?: string | null
          paciente_documento?: string | null
          paciente_edad?: number | null
          paciente_nombre?: string | null
          updated_at?: string
        }
        Update: {
          anio?: number
          anulada_at?: string | null
          anulada_por?: string | null
          branch_id?: number
          correlativo?: number
          creada_por?: string
          created_at?: string
          estado?: string
          fecha_prescripcion?: string | null
          foto_url?: string | null
          id?: never
          medico_id?: number | null
          motivo_anulacion?: string | null
          motivo_pendiente?: string | null
          notas?: string | null
          paciente_documento?: string | null
          paciente_edad?: number | null
          paciente_nombre?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recetas_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recetas_anulada_por_fkey"
            columns: ["anulada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recetas_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recetas_creada_por_fkey"
            columns: ["creada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recetas_creada_por_fkey"
            columns: ["creada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recetas_medico_id_fkey"
            columns: ["medico_id"]
            isOneToOne: false
            referencedRelation: "medicos"
            referencedColumns: ["id"]
          },
        ]
      }
      reinicios_de_la_base: {
        Row: {
          arranco_at: string
          created_at: string
          destinatarios: number | null
          detectado_at: string
        }
        Insert: {
          arranco_at: string
          created_at?: string
          destinatarios?: number | null
          detectado_at?: string
        }
        Update: {
          arranco_at?: string
          created_at?: string
          destinatarios?: number | null
          detectado_at?: string
        }
        Relationships: []
      }
      retiro_bultos: {
        Row: {
          cargado_at: string
          created_at: string
          entregado_at: string | null
          entrego_id: string | null
          firma_requerida: boolean
          id: string
          origen_branch_id: number | null
          request_id: string
          retiro_id: string
        }
        Insert: {
          cargado_at?: string
          created_at?: string
          entregado_at?: string | null
          entrego_id?: string | null
          firma_requerida?: boolean
          id?: string
          origen_branch_id?: number | null
          request_id: string
          retiro_id: string
        }
        Update: {
          cargado_at?: string
          created_at?: string
          entregado_at?: string | null
          entrego_id?: string | null
          firma_requerida?: boolean
          id?: string
          origen_branch_id?: number | null
          request_id?: string
          retiro_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retiro_bultos_entrego_id_fkey"
            columns: ["entrego_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retiro_bultos_entrego_id_fkey"
            columns: ["entrego_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retiro_bultos_origen_branch_id_fkey"
            columns: ["origen_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retiro_bultos_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retiro_bultos_retiro_id_fkey"
            columns: ["retiro_id"]
            isOneToOne: false
            referencedRelation: "retiros"
            referencedColumns: ["id"]
          },
        ]
      }
      retiro_firmas: {
        Row: {
          created_at: string
          entrego_id: string
          firmado_at: string
          id: string
          retiro_id: string
        }
        Insert: {
          created_at?: string
          entrego_id: string
          firmado_at?: string
          id?: string
          retiro_id: string
        }
        Update: {
          created_at?: string
          entrego_id?: string
          firmado_at?: string
          id?: string
          retiro_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retiro_firmas_entrego_id_fkey"
            columns: ["entrego_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retiro_firmas_entrego_id_fkey"
            columns: ["entrego_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retiro_firmas_retiro_id_fkey"
            columns: ["retiro_id"]
            isOneToOne: false
            referencedRelation: "retiros"
            referencedColumns: ["id"]
          },
        ]
      }
      retiros: {
        Row: {
          abierto_at: string
          cerrado_at: string | null
          created_at: string
          id: string
          retirador_id: string
        }
        Insert: {
          abierto_at?: string
          cerrado_at?: string | null
          created_at?: string
          id?: string
          retirador_id: string
        }
        Update: {
          abierto_at?: string
          cerrado_at?: string | null
          created_at?: string
          id?: string
          retirador_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retiros_retirador_id_fkey"
            columns: ["retirador_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retiros_retirador_id_fkey"
            columns: ["retirador_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_approve: boolean
          can_edit: boolean
          can_view: boolean
          delega_en_ausencia: boolean
          id: string
          module_key: string
          role_id: number | null
          scope: string
          updated_at: string
        }
        Insert: {
          can_approve?: boolean
          can_edit?: boolean
          can_view?: boolean
          delega_en_ausencia?: boolean
          id?: string
          module_key: string
          role_id?: number | null
          scope?: string
          updated_at?: string
        }
        Update: {
          can_approve?: boolean
          can_edit?: boolean
          can_view?: boolean
          delega_en_ausencia?: boolean
          id?: string
          module_key?: string
          role_id?: number | null
          scope?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string | null
          es_cuenta_de_pruebas: boolean
          id: number
          idle_limit_min: number
          is_su: boolean
          max_limit: number | null
          max_price_level: string | null
          name: string
          parent_role_id: number | null
          rango: number
          scope: string | null
          secondary_parent_role_id: number | null
        }
        Insert: {
          created_at?: string | null
          es_cuenta_de_pruebas?: boolean
          id?: number
          idle_limit_min?: number
          is_su?: boolean
          max_limit?: number | null
          max_price_level?: string | null
          name: string
          parent_role_id?: number | null
          rango?: number
          scope?: string | null
          secondary_parent_role_id?: number | null
        }
        Update: {
          created_at?: string | null
          es_cuenta_de_pruebas?: boolean
          id?: number
          idle_limit_min?: number
          is_su?: boolean
          max_limit?: number | null
          max_price_level?: string | null
          name?: string
          parent_role_id?: number | null
          rango?: number
          scope?: string | null
          secondary_parent_role_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roles_parent_role_id_fkey"
            columns: ["parent_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roles_secondary_parent_role_id_fkey"
            columns: ["secondary_parent_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      ruta_locations: {
        Row: {
          lat: number
          lng: number
          ruta_id: string
          updated_at: string | null
        }
        Insert: {
          lat: number
          lng: number
          ruta_id: string
          updated_at?: string | null
        }
        Update: {
          lat?: number
          lng?: number
          ruta_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ruta_locations_ruta_id_fkey"
            columns: ["ruta_id"]
            isOneToOne: true
            referencedRelation: "rutas"
            referencedColumns: ["id"]
          },
        ]
      }
      ruta_pedidos: {
        Row: {
          confirmado_suc_at: string | null
          confirmado_suc_por: string | null
          discrepancia: boolean | null
          discrepancia_nota: string | null
          distancia_desde_anterior_m: number | null
          duracion_desde_anterior_min: number | null
          entregado_at: string | null
          entregado_por: string | null
          erp_sucursal_id: number
          id: string
          orden_entrega: number
          pedido_id: string
          ruta_id: string
        }
        Insert: {
          confirmado_suc_at?: string | null
          confirmado_suc_por?: string | null
          discrepancia?: boolean | null
          discrepancia_nota?: string | null
          distancia_desde_anterior_m?: number | null
          duracion_desde_anterior_min?: number | null
          entregado_at?: string | null
          entregado_por?: string | null
          erp_sucursal_id: number
          id?: string
          orden_entrega?: number
          pedido_id: string
          ruta_id: string
        }
        Update: {
          confirmado_suc_at?: string | null
          confirmado_suc_por?: string | null
          discrepancia?: boolean | null
          discrepancia_nota?: string | null
          distancia_desde_anterior_m?: number | null
          duracion_desde_anterior_min?: number | null
          entregado_at?: string | null
          entregado_por?: string | null
          erp_sucursal_id?: number
          id?: string
          orden_entrega?: number
          pedido_id?: string
          ruta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ruta_pedidos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ruta_pedidos_ruta_id_fkey"
            columns: ["ruta_id"]
            isOneToOne: false
            referencedRelation: "rutas"
            referencedColumns: ["id"]
          },
        ]
      }
      rutas: {
        Row: {
          conductor_id: string | null
          conductor_nombre: string | null
          created_at: string | null
          created_by: string | null
          distancia_total_m: number | null
          duracion_estimada_min: number | null
          id: string
          notes: string | null
          numero: number
          salida_at: string | null
          status: string
          visitas: Json
          vuelta_base_at: string | null
        }
        Insert: {
          conductor_id?: string | null
          conductor_nombre?: string | null
          created_at?: string | null
          created_by?: string | null
          distancia_total_m?: number | null
          duracion_estimada_min?: number | null
          id?: string
          notes?: string | null
          numero?: number
          salida_at?: string | null
          status?: string
          visitas?: Json
          vuelta_base_at?: string | null
        }
        Update: {
          conductor_id?: string | null
          conductor_nombre?: string | null
          created_at?: string | null
          created_by?: string | null
          distancia_total_m?: number | null
          duracion_estimada_min?: number | null
          id?: string
          notes?: string | null
          numero?: number
          salida_at?: string | null
          status?: string
          visitas?: Json
          vuelta_base_at?: string | null
        }
        Relationships: []
      }
      sales_alert_log: {
        Row: {
          alert_key: string
          alert_type: string
          branch_id: number
          id: number
          sent_at: string | null
        }
        Insert: {
          alert_key: string
          alert_type: string
          branch_id: number
          id?: number
          sent_at?: string | null
        }
        Update: {
          alert_key?: string
          alert_type?: string
          branch_id?: number
          id?: number
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_alert_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_daily_stats: {
        Row: {
          branch_id: number
          count_valid: number
          date: string
          sum_no_producto: number
          sum_total: number
        }
        Insert: {
          branch_id: number
          count_valid?: number
          date: string
          sum_no_producto?: number
          sum_total?: number
        }
        Update: {
          branch_id?: number
          count_valid?: number
          date?: string
          sum_no_producto?: number
          sum_total?: number
        }
        Relationships: []
      }
      sales_dte_documents: {
        Row: {
          codigo_generacion: string
          created_at: string
          descargado_at: string | null
          id: number
          invoice_id: number
          json_bytes: number | null
          json_path: string | null
          pdf_bytes: number | null
          pdf_path: string | null
        }
        Insert: {
          codigo_generacion: string
          created_at?: string
          descargado_at?: string | null
          id?: never
          invoice_id: number
          json_bytes?: number | null
          json_path?: string | null
          pdf_bytes?: number | null
          pdf_path?: string | null
        }
        Update: {
          codigo_generacion?: string
          created_at?: string
          descargado_at?: string | null
          id?: never
          invoice_id?: number
          json_bytes?: number | null
          json_path?: string | null
          pdf_bytes?: number | null
          pdf_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_dte_documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_dte_documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_dte_documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      sales_gap_resolutions: {
        Row: {
          branch_id: number
          comment: string | null
          gap_from: number
          gap_to: number
          id: number
          resolved_at: string | null
          resolved_by: string | null
          tipo_documento: string
        }
        Insert: {
          branch_id: number
          comment?: string | null
          gap_from: number
          gap_to: number
          id?: number
          resolved_at?: string | null
          resolved_by?: string | null
          tipo_documento: string
        }
        Update: {
          branch_id?: number
          comment?: string | null
          gap_from?: number
          gap_to?: number
          id?: number
          resolved_at?: string | null
          resolved_by?: string | null
          tipo_documento?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_sgr_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_changelog: {
        Row: {
          branch_id: number
          campo: string
          codigo_generacion: string | null
          detected_at: string | null
          id: number
          invoice_id: number
          tipo_documento: string | null
          valor_anterior: string | null
          valor_nuevo: string | null
        }
        Insert: {
          branch_id: number
          campo: string
          codigo_generacion?: string | null
          detected_at?: string | null
          id?: number
          invoice_id: number
          tipo_documento?: string | null
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Update: {
          branch_id?: number
          campo?: string
          codigo_generacion?: string | null
          detected_at?: string | null
          id?: number
          invoice_id?: number
          tipo_documento?: string | null
          valor_anterior?: string | null
          valor_nuevo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sic_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_changelog_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_changelog_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_changelog_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      sales_invoice_items: {
        Row: {
          cantidad: number | null
          costo_ambiguo: boolean | null
          costo_origen: string | null
          costo_unitario: number | null
          descripcion: string | null
          erp_product_id: number | null
          factor_unidades: number | null
          fecha_vencimiento: string | null
          id: number
          id_presentacion: number | null
          invoice_id: number
          linea_num: number
          lote: string | null
          precio_unitario: number | null
          presentacion: string | null
          total_linea: number | null
        }
        Insert: {
          cantidad?: number | null
          costo_ambiguo?: boolean | null
          costo_origen?: string | null
          costo_unitario?: number | null
          descripcion?: string | null
          erp_product_id?: number | null
          factor_unidades?: number | null
          fecha_vencimiento?: string | null
          id?: number
          id_presentacion?: number | null
          invoice_id: number
          linea_num: number
          lote?: string | null
          precio_unitario?: number | null
          presentacion?: string | null
          total_linea?: number | null
        }
        Update: {
          cantidad?: number | null
          costo_ambiguo?: boolean | null
          costo_origen?: string | null
          costo_unitario?: number | null
          descripcion?: string | null
          erp_product_id?: number | null
          factor_unidades?: number | null
          fecha_vencimiento?: string | null
          id?: number
          id_presentacion?: number | null
          invoice_id?: number
          linea_num?: number
          lote?: string | null
          precio_unitario?: number | null
          presentacion?: string | null
          total_linea?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_sii_presentacion"
            columns: ["id_presentacion"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      sales_invoice_resolutions: {
        Row: {
          comment: string | null
          id: number
          invoice_id: number
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          comment?: string | null
          id?: never
          invoice_id: number
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          comment?: string | null
          id?: never
          invoice_id?: number
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_resolution_invoice"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_resolution_invoice"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_resolution_invoice"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      sales_invoices: {
        Row: {
          branch_id: number
          cliente: string | null
          cod_vendedor: string | null
          codigo_generacion: string | null
          correlativo: string | null
          created_at: string | null
          customer_id: number | null
          erp_invoice_id: string
          estado: string | null
          fecha: string
          has_puntos: boolean
          hora: string
          id: number
          iva: number | null
          numero_control: string | null
          recibido_mh: string | null
          retencion: number
          subtotal: number | null
          tipo_documento: string | null
          tipo_pago: string | null
          total: number | null
          updated_at: string | null
        }
        Insert: {
          branch_id: number
          cliente?: string | null
          cod_vendedor?: string | null
          codigo_generacion?: string | null
          correlativo?: string | null
          created_at?: string | null
          customer_id?: number | null
          erp_invoice_id: string
          estado?: string | null
          fecha: string
          has_puntos?: boolean
          hora: string
          id?: number
          iva?: number | null
          numero_control?: string | null
          recibido_mh?: string | null
          retencion?: number
          subtotal?: number | null
          tipo_documento?: string | null
          tipo_pago?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Update: {
          branch_id?: number
          cliente?: string | null
          cod_vendedor?: string | null
          codigo_generacion?: string | null
          correlativo?: string | null
          created_at?: string | null
          customer_id?: number | null
          erp_invoice_id?: string
          estado?: string | null
          fecha?: string
          has_puntos?: boolean
          hora?: string
          id?: number
          iva?: number | null
          numero_control?: string | null
          recibido_mh?: string | null
          retencion?: number
          subtotal?: number | null
          tipo_documento?: string | null
          tipo_pago?: string | null
          total?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      sales_null_resolutions: {
        Row: {
          comment: string | null
          id: number
          null_id: number
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          comment?: string | null
          id?: number
          null_id: number
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          comment?: string | null
          id?: number
          null_id?: number
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: []
      }
      sales_observation_resolutions: {
        Row: {
          comment: string | null
          created_at: string
          id: number
          invoice_id: number
          resolved_at: string
          resolved_by: string | null
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: never
          invoice_id: number
          resolved_at?: string
          resolved_by?: string | null
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: never
          invoice_id?: number
          resolved_at?: string
          resolved_by?: string | null
        }
        Relationships: []
      }
      sales_payment_confirmations: {
        Row: {
          branch_id: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          confirmed_by_photo: string | null
          id: number
          invoice_id: number
          notes: string | null
          proof_url: string | null
          tipo_pago: string | null
        }
        Insert: {
          branch_id?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_photo?: string | null
          id?: number
          invoice_id: number
          notes?: string | null
          proof_url?: string | null
          tipo_pago?: string | null
        }
        Update: {
          branch_id?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          confirmed_by_photo?: string | null
          id?: number
          invoice_id?: number
          notes?: string | null
          proof_url?: string | null
          tipo_pago?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_payment_confirmations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_payment_confirmations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_payment_confirmations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      schedule_coverage: {
        Row: {
          coverage_branch_id: number
          created_at: string | null
          day_of_week: number
          employee_id: string
          home_branch_id: number | null
          id: string
          schedule_data: Json
          updated_at: string | null
          week_start_date: string
        }
        Insert: {
          coverage_branch_id: number
          created_at?: string | null
          day_of_week: number
          employee_id: string
          home_branch_id?: number | null
          id?: string
          schedule_data?: Json
          updated_at?: string | null
          week_start_date: string
        }
        Update: {
          coverage_branch_id?: number
          created_at?: string | null
          day_of_week?: number
          employee_id?: string
          home_branch_id?: number | null
          id?: string
          schedule_data?: Json
          updated_at?: string | null
          week_start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_coverage_coverage_branch_id_fkey"
            columns: ["coverage_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_coverage_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_coverage_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_coverage_home_branch_id_fkey"
            columns: ["home_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      security_config: {
        Row: {
          created_at: string
          estado: string
          key: string
          nota: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          estado?: string
          key: string
          nota?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          estado?: string
          key?: string
          nota?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      session_activity: {
        Row: {
          created_at: string
          device_class: string
          last_seen_at: string
          session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_class?: string
          last_seen_at?: string
          session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_class?: string
          last_seen_at?: string
          session_id?: string
          user_id?: string
        }
        Relationships: []
      }
      session_last_seen: {
        Row: {
          created_at: string
          device_class: string
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_class?: string
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_class?: string
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          branch_id: number | null
          color: string | null
          created_at: string
          end_time: string
          id: number
          is_active: boolean | null
          lunch_minutes: number
          lunch_start: string | null
          name: string
          start_time: string
        }
        Insert: {
          branch_id?: number | null
          color?: string | null
          created_at?: string
          end_time: string
          id?: number
          is_active?: boolean | null
          lunch_minutes?: number
          lunch_start?: string | null
          name: string
          start_time: string
        }
        Update: {
          branch_id?: number | null
          color?: string | null
          created_at?: string
          end_time?: string
          id?: number
          is_active?: boolean | null
          lunch_minutes?: number
          lunch_start?: string | null
          name?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_datos: {
        Row: {
          anio: number
          branch_id: number | null
          created_at: string
          derechos: string[]
          descripcion: string | null
          estado: string
          folio: number
          folio_txt: string | null
          id: string
          identidad_cotejada_por: string | null
          identidad_documento: string | null
          identidad_numero: string | null
          impresa_at: string
          impresa_por: string | null
          motivo_negativa: string | null
          negada: boolean
          notas: string | null
          por_representacion: boolean
          prevencion: string | null
          prevenida_at: string | null
          prorrogada_at: string | null
          recibida_at: string | null
          recibida_por: string | null
          representacion_doc: string | null
          resolucion: string | null
          resuelta_at: string | null
          resuelta_por: string | null
          solicitante_correo: string | null
          solicitante_direccion: string | null
          solicitante_documento: string | null
          solicitante_nombre: string | null
          solicitante_numero: string | null
          solicitante_telefono: string | null
          updated_at: string
          via_respuesta: string | null
        }
        Insert: {
          anio: number
          branch_id?: number | null
          created_at?: string
          derechos?: string[]
          descripcion?: string | null
          estado?: string
          folio: number
          folio_txt?: string | null
          id?: string
          identidad_cotejada_por?: string | null
          identidad_documento?: string | null
          identidad_numero?: string | null
          impresa_at?: string
          impresa_por?: string | null
          motivo_negativa?: string | null
          negada?: boolean
          notas?: string | null
          por_representacion?: boolean
          prevencion?: string | null
          prevenida_at?: string | null
          prorrogada_at?: string | null
          recibida_at?: string | null
          recibida_por?: string | null
          representacion_doc?: string | null
          resolucion?: string | null
          resuelta_at?: string | null
          resuelta_por?: string | null
          solicitante_correo?: string | null
          solicitante_direccion?: string | null
          solicitante_documento?: string | null
          solicitante_nombre?: string | null
          solicitante_numero?: string | null
          solicitante_telefono?: string | null
          updated_at?: string
          via_respuesta?: string | null
        }
        Update: {
          anio?: number
          branch_id?: number | null
          created_at?: string
          derechos?: string[]
          descripcion?: string | null
          estado?: string
          folio?: number
          folio_txt?: string | null
          id?: string
          identidad_cotejada_por?: string | null
          identidad_documento?: string | null
          identidad_numero?: string | null
          impresa_at?: string
          impresa_por?: string | null
          motivo_negativa?: string | null
          negada?: boolean
          notas?: string | null
          por_representacion?: boolean
          prevencion?: string | null
          prevenida_at?: string | null
          prorrogada_at?: string | null
          recibida_at?: string | null
          recibida_por?: string | null
          representacion_doc?: string | null
          resolucion?: string | null
          resuelta_at?: string | null
          resuelta_por?: string | null
          solicitante_correo?: string | null
          solicitante_direccion?: string | null
          solicitante_documento?: string | null
          solicitante_nombre?: string | null
          solicitante_numero?: string | null
          solicitante_telefono?: string | null
          updated_at?: string
          via_respuesta?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_datos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_identidad_cotejada_por_fkey"
            columns: ["identidad_cotejada_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_identidad_cotejada_por_fkey"
            columns: ["identidad_cotejada_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_impresa_por_fkey"
            columns: ["impresa_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_impresa_por_fkey"
            columns: ["impresa_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_recibida_por_fkey"
            columns: ["recibida_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_recibida_por_fkey"
            columns: ["recibida_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_resuelta_por_fkey"
            columns: ["resuelta_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitudes_datos_resuelta_por_fkey"
            columns: ["resuelta_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_datos_avisos: {
        Row: {
          created_at: string
          destinatarios: number
          etapa: string
          solicitud_id: string
        }
        Insert: {
          created_at?: string
          destinatarios?: number
          etapa: string
          solicitud_id: string
        }
        Update: {
          created_at?: string
          destinatarios?: number
          etapa?: string
          solicitud_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "solicitudes_datos_avisos_solicitud_id_fkey"
            columns: ["solicitud_id"]
            isOneToOne: false
            referencedRelation: "solicitudes_datos"
            referencedColumns: ["id"]
          },
        ]
      }
      solicitudes_datos_folios: {
        Row: {
          anio: number
          created_at: string
          ultimo: number
        }
        Insert: {
          anio: number
          created_at?: string
          ultimo?: number
        }
        Update: {
          anio?: number
          created_at?: string
          ultimo?: number
        }
        Relationships: []
      }
      stock_config: {
        Row: {
          abc_a_pct: number
          abc_b_pct: number
          analysis_days: number
          approaching_pct: number | null
          buffer_x_days: number | null
          buffer_y_days: number | null
          buffer_z_days: number | null
          cycle_days: number
          id: number
          outlier_percentile: number | null
          pedido_recepcion_activa: boolean
          reorder_x_days: number
          reorder_y_days: number
          reorder_z_days: number
          updated_at: string | null
          updated_by: string | null
          xyz_x_cv_max: number
          xyz_x_percentile: number
          xyz_y_cv_max: number
          xyz_y_percentile: number
        }
        Insert: {
          abc_a_pct?: number
          abc_b_pct?: number
          analysis_days?: number
          approaching_pct?: number | null
          buffer_x_days?: number | null
          buffer_y_days?: number | null
          buffer_z_days?: number | null
          cycle_days?: number
          id?: number
          outlier_percentile?: number | null
          pedido_recepcion_activa?: boolean
          reorder_x_days?: number
          reorder_y_days?: number
          reorder_z_days?: number
          updated_at?: string | null
          updated_by?: string | null
          xyz_x_cv_max?: number
          xyz_x_percentile?: number
          xyz_y_cv_max?: number
          xyz_y_percentile?: number
        }
        Update: {
          abc_a_pct?: number
          abc_b_pct?: number
          analysis_days?: number
          approaching_pct?: number | null
          buffer_x_days?: number | null
          buffer_y_days?: number | null
          buffer_z_days?: number | null
          cycle_days?: number
          id?: number
          outlier_percentile?: number | null
          pedido_recepcion_activa?: boolean
          reorder_x_days?: number
          reorder_y_days?: number
          reorder_z_days?: number
          updated_at?: string | null
          updated_by?: string | null
          xyz_x_cv_max?: number
          xyz_x_percentile?: number
          xyz_y_cv_max?: number
          xyz_y_percentile?: number
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          created_at: string | null
          erp_supplier_id: number | null
          id: number
          nombre: string
          nrc: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          erp_supplier_id?: number | null
          id?: number
          nombre: string
          nrc?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          erp_supplier_id?: number | null
          id?: number
          nombre?: string
          nrc?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      survey_bloques: {
        Row: {
          color: string
          ctx_badge: string | null
          ctx_dirigido: string | null
          ctx_nota: string | null
          ctx_tipo: string | null
          descripcion: string | null
          id: number
          indices: number[]
          nombre: string
          numero: number
          survey_id: number
        }
        Insert: {
          color?: string
          ctx_badge?: string | null
          ctx_dirigido?: string | null
          ctx_nota?: string | null
          ctx_tipo?: string | null
          descripcion?: string | null
          id?: number
          indices?: number[]
          nombre: string
          numero: number
          survey_id: number
        }
        Update: {
          color?: string
          ctx_badge?: string | null
          ctx_dirigido?: string | null
          ctx_nota?: string | null
          ctx_tipo?: string | null
          descripcion?: string | null
          id?: number
          indices?: number[]
          nombre?: string
          numero?: number
          survey_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "survey_bloques_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_preguntas: {
        Row: {
          bloque_id: number | null
          id: number
          indice: number
          invertida: boolean
          numero: number
          opciones: Json | null
          survey_id: number
          texto: string
          tipo: string
        }
        Insert: {
          bloque_id?: number | null
          id?: number
          indice: number
          invertida?: boolean
          numero: number
          opciones?: Json | null
          survey_id: number
          texto: string
          tipo?: string
        }
        Update: {
          bloque_id?: number | null
          id?: number
          indice?: number
          invertida?: boolean
          numero?: number
          opciones?: Json | null
          survey_id?: number
          texto?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_preguntas_bloque_id_fkey"
            columns: ["bloque_id"]
            isOneToOne: false
            referencedRelation: "survey_bloques"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_preguntas_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          comentario: string | null
          created_at: string | null
          display_name: string | null
          employee_id: string
          id: number
          is_jefe: boolean
          responses: Json
          survey_id: number
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          comentario?: string | null
          created_at?: string | null
          display_name?: string | null
          employee_id: string
          id?: number
          is_jefe?: boolean
          responses: Json
          survey_id: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          comentario?: string | null
          created_at?: string | null
          display_name?: string | null
          employee_id?: string
          id?: number
          is_jefe?: boolean
          responses?: Json
          survey_id?: number
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_responses_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          ai_summaries: Json | null
          año: number
          anonima: boolean
          compartir_resultados: boolean
          created_at: string | null
          created_by: string | null
          descripcion: string | null
          estado: string
          fecha_aplicacion: string | null
          fecha_fin: string | null
          fecha_inicio: string | null
          id: number
          nombre: string
          scope_ids: Json
          scope_tipo: string
          tipo: string
        }
        Insert: {
          ai_summaries?: Json | null
          año: number
          anonima?: boolean
          compartir_resultados?: boolean
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_aplicacion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: number
          nombre: string
          scope_ids?: Json
          scope_tipo?: string
          tipo?: string
        }
        Update: {
          ai_summaries?: Json | null
          año?: number
          anonima?: boolean
          compartir_resultados?: boolean
          created_at?: string | null
          created_by?: string | null
          descripcion?: string | null
          estado?: string
          fecha_aplicacion?: string | null
          fecha_fin?: string | null
          fecha_inicio?: string | null
          id?: number
          nombre?: string
          scope_ids?: Json
          scope_tipo?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surveys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_alert_log: {
        Row: {
          alert_key: string
          created_at: string
          domain: string
          id: number
          scope_key: string
          sent_at: string
        }
        Insert: {
          alert_key: string
          created_at?: string
          domain: string
          id?: number
          scope_key: string
          sent_at?: string
        }
        Update: {
          alert_key?: string
          created_at?: string
          domain?: string
          id?: number
          scope_key?: string
          sent_at?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          attempts: number | null
          branch_id: number
          error_msg: string | null
          ffin: string
          fini: string
          id: number
          id_max: number | null
          id_min: number | null
          invoices_new: number | null
          invoices_total: number | null
          items_inserted: number | null
          ran_at: string | null
          success: boolean
        }
        Insert: {
          attempts?: number | null
          branch_id: number
          error_msg?: string | null
          ffin: string
          fini: string
          id?: number
          id_max?: number | null
          id_min?: number | null
          invoices_new?: number | null
          invoices_total?: number | null
          items_inserted?: number | null
          ran_at?: string | null
          success: boolean
        }
        Update: {
          attempts?: number | null
          branch_id?: number
          error_msg?: string | null
          ffin?: string
          fini?: string
          id?: number
          id_max?: number | null
          id_min?: number | null
          invoices_new?: number | null
          invoices_total?: number | null
          items_inserted?: number | null
          ran_at?: string | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "fk_synclog_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      timesheets: {
        Row: {
          absence_type: string | null
          actual_end_time: string | null
          actual_start_time: string | null
          created_at: string | null
          employee_id: string
          id: string
          is_absent: boolean | null
          is_holiday_worked: boolean | null
          late_minutes: number | null
          nocturnal_hours: number | null
          nocturnal_overtime_hours: number | null
          overtime_hours: number | null
          regular_hours: number | null
          scheduled_shift_id: number | null
          status: string | null
          updated_at: string | null
          work_date: string
        }
        Insert: {
          absence_type?: string | null
          actual_end_time?: string | null
          actual_start_time?: string | null
          created_at?: string | null
          employee_id: string
          id?: string
          is_absent?: boolean | null
          is_holiday_worked?: boolean | null
          late_minutes?: number | null
          nocturnal_hours?: number | null
          nocturnal_overtime_hours?: number | null
          overtime_hours?: number | null
          regular_hours?: number | null
          scheduled_shift_id?: number | null
          status?: string | null
          updated_at?: string | null
          work_date: string
        }
        Update: {
          absence_type?: string | null
          actual_end_time?: string | null
          actual_start_time?: string | null
          created_at?: string | null
          employee_id?: string
          id?: string
          is_absent?: boolean | null
          is_holiday_worked?: boolean | null
          late_minutes?: number | null
          nocturnal_hours?: number | null
          nocturnal_overtime_hours?: number | null
          overtime_hours?: number | null
          regular_hours?: number | null
          scheduled_shift_id?: number | null
          status?: string | null
          updated_at?: string | null
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_scheduled_shift_id_fkey"
            columns: ["scheduled_shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      traslado_interruptor: {
        Row: {
          accion: string
          cambiado_at: string
          cambiado_por: string | null
          created_at: string
          motivo: string | null
          pausado: boolean
        }
        Insert: {
          accion: string
          cambiado_at?: string
          cambiado_por?: string | null
          created_at?: string
          motivo?: string | null
          pausado?: boolean
        }
        Update: {
          accion?: string
          cambiado_at?: string
          cambiado_por?: string | null
          created_at?: string
          motivo?: string | null
          pausado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "traslado_interruptor_cambiado_por_fkey"
            columns: ["cambiado_por"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traslado_interruptor_cambiado_por_fkey"
            columns: ["cambiado_por"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      traslados_erp_linea: {
        Row: {
          cantidad: number | null
          created_at: string
          descripcion: string
          erp_product_id: number | null
          erp_sucursal_destino: number | null
          fecha: string
          fuente: string
          id: number
          id_traslado: number
          posicion: number
          presentacion: string | null
          unidad: number | null
        }
        Insert: {
          cantidad?: number | null
          created_at?: string
          descripcion: string
          erp_product_id?: number | null
          erp_sucursal_destino?: number | null
          fecha: string
          fuente: string
          id?: never
          id_traslado: number
          posicion: number
          presentacion?: string | null
          unidad?: number | null
        }
        Update: {
          cantidad?: number | null
          created_at?: string
          descripcion?: string
          erp_product_id?: number | null
          erp_sucursal_destino?: number | null
          fecha?: string
          fuente?: string
          id?: never
          id_traslado?: number
          posicion?: number
          presentacion?: string | null
          unidad?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "traslados_erp_linea_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "traslados_erp_linea_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      user_dashboard_prefs: {
        Row: {
          arranged: Json
          layout: Json
          mobile_layout: Json | null
          mobile_sizes: Json | null
          mobile_theme: string | null
          sizes: Json
          theme: string | null
          updated_at: string
          user_id: string
          widgets: Json
        }
        Insert: {
          arranged?: Json
          layout?: Json
          mobile_layout?: Json | null
          mobile_sizes?: Json | null
          mobile_theme?: string | null
          sizes?: Json
          theme?: string | null
          updated_at?: string
          user_id: string
          widgets?: Json
        }
        Update: {
          arranged?: Json
          layout?: Json
          mobile_layout?: Json | null
          mobile_sizes?: Json | null
          mobile_theme?: string | null
          sizes?: Json
          theme?: string | null
          updated_at?: string
          user_id?: string
          widgets?: Json
        }
        Relationships: [
          {
            foreignKeyName: "user_dashboard_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_dashboard_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      vacation_plan_headers: {
        Row: {
          ai_generated: boolean
          created_at: string | null
          generated_by: string | null
          id: string
          notes: string | null
          status: string
          updated_at: string | null
          year: number
        }
        Insert: {
          ai_generated?: boolean
          created_at?: string | null
          generated_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          year: number
        }
        Update: {
          ai_generated?: boolean
          created_at?: string | null
          generated_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: []
      }
      vacation_plans: {
        Row: {
          branch_id: number
          change_requested_end: string | null
          change_requested_start: string | null
          created_at: string | null
          created_by: string | null
          days: number
          employee_id: string
          end_date: string
          end_time: string | null
          id: string
          metadata: Json | null
          notes: string | null
          plan_header_id: string | null
          start_date: string
          start_time: string | null
          status: string
          updated_at: string | null
          year: number
        }
        Insert: {
          branch_id: number
          change_requested_end?: string | null
          change_requested_start?: string | null
          created_at?: string | null
          created_by?: string | null
          days?: number
          employee_id: string
          end_date: string
          end_time?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          plan_header_id?: string | null
          start_date: string
          start_time?: string | null
          status?: string
          updated_at?: string | null
          year: number
        }
        Update: {
          branch_id?: number
          change_requested_end?: string | null
          change_requested_start?: string | null
          created_at?: string | null
          created_by?: string | null
          days?: number
          employee_id?: string
          end_date?: string
          end_time?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          plan_header_id?: string | null
          start_date?: string
          start_time?: string | null
          status?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "vacation_plans_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vacation_plans_plan_header_id_fkey"
            columns: ["plan_header_id"]
            isOneToOne: false
            referencedRelation: "vacation_plan_headers"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_cuadre_hallazgos: {
        Row: {
          branch_id: number
          created_at: string
          diagnosticado_at: string
          diferencia: number
          documentos: Json
          fecha: string
          id: number
          resuelto_at: string | null
          sin_explicar: number
          total_erp: number
          total_portal: number
        }
        Insert: {
          branch_id: number
          created_at?: string
          diagnosticado_at?: string
          diferencia?: number
          documentos?: Json
          fecha: string
          id?: never
          resuelto_at?: string | null
          sin_explicar?: number
          total_erp?: number
          total_portal?: number
        }
        Update: {
          branch_id?: number
          created_at?: string
          diagnosticado_at?: string
          diferencia?: number
          documentos?: Json
          fecha?: string
          id?: never
          resuelto_at?: string | null
          sin_explicar?: number
          total_erp?: number
          total_portal?: number
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cuadre_hallazgos_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_monthly_stats: {
        Row: {
          avg_ticket: number
          branch_id: number
          cod_vendedor: string
          mes: string
          total_count: number
          total_sum: number
          updated_at: string | null
        }
        Insert: {
          avg_ticket?: number
          branch_id?: number
          cod_vendedor?: string
          mes: string
          total_count?: number
          total_sum?: number
          updated_at?: string | null
        }
        Update: {
          avg_ticket?: number
          branch_id?: number
          cod_vendedor?: string
          mes?: string
          total_count?: number
          total_sum?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      ventas_perdidas: {
        Row: {
          branch_id: number | null
          cantidad: number
          created_at: string
          descripcion: string | null
          erp_product_id: number | null
          id: number
          laboratorio: string | null
          notas: string | null
          principio_activo: string | null
          producto_buscado: string
          reportado_por: string | null
          status: string
        }
        Insert: {
          branch_id?: number | null
          cantidad?: number
          created_at?: string
          descripcion?: string | null
          erp_product_id?: number | null
          id?: never
          laboratorio?: string | null
          notas?: string | null
          principio_activo?: string | null
          producto_buscado: string
          reportado_por?: string | null
          status?: string
        }
        Update: {
          branch_id?: number | null
          cantidad?: number
          created_at?: string
          descripcion?: string | null
          erp_product_id?: number | null
          id?: never
          laboratorio?: string | null
          notas?: string | null
          principio_activo?: string | null
          producto_buscado?: string
          reportado_por?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ventas_perdidas_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_perdidas_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_perdidas_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      wfm_snapshots: {
        Row: {
          base_staff_hours: number
          branch_id: number
          created_at: string | null
          extra_volume_hours: number
          id: string
          peak_avg_sales: number | null
          peak_day_name: string | null
          peak_hour: number | null
          recommended_staff: number
          shrinkage_hours: number
          snapshot_date: string
          total_labor_hours: number
        }
        Insert: {
          base_staff_hours: number
          branch_id: number
          created_at?: string | null
          extra_volume_hours: number
          id?: string
          peak_avg_sales?: number | null
          peak_day_name?: string | null
          peak_hour?: number | null
          recommended_staff: number
          shrinkage_hours: number
          snapshot_date?: string
          total_labor_hours: number
        }
        Update: {
          base_staff_hours?: number
          branch_id?: number
          created_at?: string | null
          extra_volume_hours?: number
          id?: string
          peak_avg_sales?: number | null
          peak_day_name?: string | null
          peak_hour?: number | null
          recommended_staff?: number
          shrinkage_hours?: number
          snapshot_date?: string
          total_labor_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_wfm_snapshots_branch"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      branch_hourly_sales: {
        Row: {
          branch_id: number | null
          sale_date: string | null
          sale_hour: number | null
          total_sales: number | null
          transaction_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      compra_deuda_documentos: {
        Row: {
          aplicado: number | null
          codigo_generacion: string | null
          dias_credito: number | null
          document_id: number | null
          emisor_nit: string | null
          emisor_nombre: string | null
          en_tramite: number | null
          fecha_emision: string | null
          monto: number | null
          numero_control: string | null
          tipo_dte: string | null
          vence: string | null
        }
        Relationships: []
      }
      conteo_presentacion_grupo: {
        Row: {
          grupo_key: string | null
          pres_key: string | null
          product_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      dte_rechazos_vigentes: {
        Row: {
          accionable: boolean | null
          branch_id: number | null
          campo_ficha: string | null
          categoria: string | null
          cliente: string | null
          codigo_msg: string | null
          correlativo: string | null
          customer_id: number | null
          departamento: string | null
          distrito: string | null
          dui: string | null
          erp_id: string | null
          familia: string | null
          invoice_id: number | null
          motivo: string | null
          municipio: string | null
          ruta: string | null
          ultimo_intento: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dte_mh_intentos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoice_nulls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_mh_intentos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "sales_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dte_mh_intentos_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "ventas_sin_producto"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      employee_timeline: {
        Row: {
          category: string | null
          created_at: string | null
          employee_id: string | null
          event_date: string | null
          event_end_date: string | null
          event_type: string | null
          metadata: Json | null
          note: string | null
        }
        Relationships: []
      }
      employees_safe: {
        Row: {
          account_type: string | null
          acreditaciones: Json | null
          additional_skills: Json | null
          address: string | null
          afp_estado: string | null
          afp_institution: string | null
          alt_identity_document_type: string | null
          birth_date: string | null
          blocked_at: string | null
          blocked_by: string | null
          blocked_reason: string | null
          blocked_until: string | null
          blood_type: string | null
          branch_id: number | null
          carne_dependiente_url: string | null
          carne_pendiente: boolean | null
          chronic_conditions: Json | null
          contador_license_number: string | null
          contract_end_date: string | null
          contract_start_date: string | null
          contract_temporal_legal_basis: string | null
          contract_temporal_reason: string | null
          contract_type: string | null
          contrato_fecha_celebracion: string | null
          contrato_lugar_celebracion: string | null
          contrato_prorrogas: Json | null
          created_at: string | null
          department: string | null
          disability_grade: string | null
          disability_has_certification: boolean | null
          disability_type: string | null
          distrito: string | null
          economic_dependents: Json | null
          education_grade_completed: string | null
          education_level: string | null
          education_specialty: string | null
          email: string | null
          emergency_contact_extra_phones: string[] | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          emergency_contacts: Json | null
          employee_documents: Json | null
          exceptions: Json | null
          extra_addresses: Json | null
          extra_emails: string[] | null
          extra_phones: string[] | null
          first_names: string | null
          forma_estipulacion_salario: string | null
          gender: string | null
          has_car: boolean | null
          has_car_license: boolean | null
          has_disability: boolean | null
          has_maestria: boolean | null
          has_motorcycle: boolean | null
          has_motorcycle_license: boolean | null
          has_srs_accreditation: boolean | null
          herramientas_entregadas: Json | null
          hire_date: string | null
          hours_owed: number | null
          id: string | null
          is_studying: boolean | null
          isss_estado: string | null
          last_names: string | null
          lugar_nacimiento: string | null
          lugar_pago: string | null
          maestria_is_studying: boolean | null
          maestria_study_duration_years: number | null
          maestria_study_start_date: string | null
          maestria_title: string | null
          marital_status: string | null
          medico_license_number: string | null
          medio_pago: string | null
          mtps_remitido_fecha: string | null
          municipality: string | null
          name: string | null
          nationality: string | null
          nursing_license_number: string | null
          periodo_pago: string | null
          pharmacist_license_number: string | null
          phone: string | null
          photo_url: string | null
          profession: string | null
          rango: number | null
          role_id: number | null
          secondary_role_id: number | null
          shift_id: number | null
          srs_accreditation_expiry: string | null
          status: string | null
          study_duration_years: number | null
          study_start_date: string | null
          suplente_id: string | null
          system_role: string | null
          tiene_acreditacion_dependiente: boolean | null
          tipo_ficha: string | null
          username: string | null
          weekly_contracted_hours: number | null
          weekly_schedule: Json | null
        }
        Insert: {
          account_type?: string | null
          acreditaciones?: Json | null
          additional_skills?: Json | null
          address?: string | null
          afp_estado?: string | null
          afp_institution?: string | null
          alt_identity_document_type?: string | null
          birth_date?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          blood_type?: string | null
          branch_id?: number | null
          carne_dependiente_url?: string | null
          carne_pendiente?: boolean | null
          chronic_conditions?: Json | null
          contador_license_number?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_temporal_legal_basis?: string | null
          contract_temporal_reason?: string | null
          contract_type?: string | null
          contrato_fecha_celebracion?: string | null
          contrato_lugar_celebracion?: string | null
          contrato_prorrogas?: Json | null
          created_at?: string | null
          department?: string | null
          disability_grade?: string | null
          disability_has_certification?: boolean | null
          disability_type?: string | null
          distrito?: string | null
          economic_dependents?: Json | null
          education_grade_completed?: string | null
          education_level?: string | null
          education_specialty?: string | null
          email?: string | null
          emergency_contact_extra_phones?: string[] | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          emergency_contacts?: Json | null
          employee_documents?: Json | null
          exceptions?: Json | null
          extra_addresses?: Json | null
          extra_emails?: string[] | null
          extra_phones?: string[] | null
          first_names?: string | null
          forma_estipulacion_salario?: string | null
          gender?: string | null
          has_car?: boolean | null
          has_car_license?: boolean | null
          has_disability?: boolean | null
          has_maestria?: boolean | null
          has_motorcycle?: boolean | null
          has_motorcycle_license?: boolean | null
          has_srs_accreditation?: boolean | null
          herramientas_entregadas?: Json | null
          hire_date?: string | null
          hours_owed?: number | null
          id?: string | null
          is_studying?: boolean | null
          isss_estado?: string | null
          last_names?: string | null
          lugar_nacimiento?: string | null
          lugar_pago?: string | null
          maestria_is_studying?: boolean | null
          maestria_study_duration_years?: number | null
          maestria_study_start_date?: string | null
          maestria_title?: string | null
          marital_status?: string | null
          medico_license_number?: string | null
          medio_pago?: string | null
          mtps_remitido_fecha?: string | null
          municipality?: string | null
          name?: string | null
          nationality?: string | null
          nursing_license_number?: string | null
          periodo_pago?: string | null
          pharmacist_license_number?: string | null
          phone?: string | null
          photo_url?: string | null
          profession?: string | null
          rango?: never
          role_id?: number | null
          secondary_role_id?: number | null
          shift_id?: number | null
          srs_accreditation_expiry?: string | null
          status?: string | null
          study_duration_years?: number | null
          study_start_date?: string | null
          suplente_id?: string | null
          system_role?: never
          tiene_acreditacion_dependiente?: boolean | null
          tipo_ficha?: string | null
          username?: string | null
          weekly_contracted_hours?: number | null
          weekly_schedule?: Json | null
        }
        Update: {
          account_type?: string | null
          acreditaciones?: Json | null
          additional_skills?: Json | null
          address?: string | null
          afp_estado?: string | null
          afp_institution?: string | null
          alt_identity_document_type?: string | null
          birth_date?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          blood_type?: string | null
          branch_id?: number | null
          carne_dependiente_url?: string | null
          carne_pendiente?: boolean | null
          chronic_conditions?: Json | null
          contador_license_number?: string | null
          contract_end_date?: string | null
          contract_start_date?: string | null
          contract_temporal_legal_basis?: string | null
          contract_temporal_reason?: string | null
          contract_type?: string | null
          contrato_fecha_celebracion?: string | null
          contrato_lugar_celebracion?: string | null
          contrato_prorrogas?: Json | null
          created_at?: string | null
          department?: string | null
          disability_grade?: string | null
          disability_has_certification?: boolean | null
          disability_type?: string | null
          distrito?: string | null
          economic_dependents?: Json | null
          education_grade_completed?: string | null
          education_level?: string | null
          education_specialty?: string | null
          email?: string | null
          emergency_contact_extra_phones?: string[] | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          emergency_contacts?: Json | null
          employee_documents?: Json | null
          exceptions?: Json | null
          extra_addresses?: Json | null
          extra_emails?: string[] | null
          extra_phones?: string[] | null
          first_names?: string | null
          forma_estipulacion_salario?: string | null
          gender?: string | null
          has_car?: boolean | null
          has_car_license?: boolean | null
          has_disability?: boolean | null
          has_maestria?: boolean | null
          has_motorcycle?: boolean | null
          has_motorcycle_license?: boolean | null
          has_srs_accreditation?: boolean | null
          herramientas_entregadas?: Json | null
          hire_date?: string | null
          hours_owed?: number | null
          id?: string | null
          is_studying?: boolean | null
          isss_estado?: string | null
          last_names?: string | null
          lugar_nacimiento?: string | null
          lugar_pago?: string | null
          maestria_is_studying?: boolean | null
          maestria_study_duration_years?: number | null
          maestria_study_start_date?: string | null
          maestria_title?: string | null
          marital_status?: string | null
          medico_license_number?: string | null
          medio_pago?: string | null
          mtps_remitido_fecha?: string | null
          municipality?: string | null
          name?: string | null
          nationality?: string | null
          nursing_license_number?: string | null
          periodo_pago?: string | null
          pharmacist_license_number?: string | null
          phone?: string | null
          photo_url?: string | null
          profession?: string | null
          rango?: never
          role_id?: number | null
          secondary_role_id?: number | null
          shift_id?: number | null
          srs_accreditation_expiry?: string | null
          status?: string | null
          study_duration_years?: number | null
          study_start_date?: string | null
          suplente_id?: string | null
          system_role?: never
          tiene_acreditacion_dependiente?: boolean | null
          tipo_ficha?: string | null
          username?: string | null
          weekly_contracted_hours?: number | null
          weekly_schedule?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_secondary_role_id_fkey"
            columns: ["secondary_role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_suplente_id_fkey"
            columns: ["suplente_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_suplente_id_fkey"
            columns: ["suplente_id"]
            isOneToOne: false
            referencedRelation: "employees_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_grouped_mv: {
        Row: {
          descripcion: string | null
          descripcion_norm: string | null
          earliest_venc: string | null
          erp_product_id: number | null
          erp_sucursal_id: number | null
          es_antibiotico: boolean | null
          laboratorio_id: number | null
          lote_sample: string | null
          num_lotes: number | null
          presentaciones: string[] | null
          soonest_active_venc: string | null
          tipo_medicamento: string | null
          total_costo: number | null
          total_unidades: number | null
          vencidos_unidades: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_laboratorio_id_fkey"
            columns: ["laboratorio_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_primera_venta_producto: {
        Row: {
          erp_product_id: number | null
          erp_sucursal_id: number | null
          primera: string | null
        }
        Relationships: []
      }
      mv_product_factor: {
        Row: {
          factor: number | null
          pres_key: string | null
          product_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_stock_analysis: {
        Row: {
          current_stock: number | null
          erp_product_id: number | null
          erp_sucursal_id: number | null
          is_catalog_only: boolean | null
          is_dead_stock: boolean | null
        }
        Relationships: []
      }
      product_cost_history: {
        Row: {
          cantidad: number | null
          descripcion: string | null
          erp_product_id: number | null
          fecha: string | null
          fecha_vencimiento: string | null
          lote: string | null
          precio_unitario: number | null
          proveedor: string | null
          supplier_id: number | null
          total_linea: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_purchase_summary: {
        Row: {
          avg_cost: number | null
          days_since_first_purchase: number | null
          distinct_suppliers: number | null
          erp_product_id: number | null
          first_purchase_date: string | null
          last_purchase_date: string | null
          latest_cost: number | null
          total_receipts: number | null
          total_units_received: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_receipt_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_receipt_items_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      products_with_lab: {
        Row: {
          activo: boolean | null
          codigo_barras: string | null
          es_antibiotico: boolean | null
          id: number | null
          laboratorio_id: number | null
          laboratorio_nombre: string | null
          nombre: string | null
          nombre_norm: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_laboratorio_id_fkey"
            columns: ["laboratorio_id"]
            isOneToOne: false
            referencedRelation: "laboratorios"
            referencedColumns: ["id"]
          },
        ]
      }
      puntos_cuentas_pendientes: {
        Row: {
          dui: string | null
          id_cliente: number | null
          motivo: string | null
          nombre: string | null
          saldo: number | null
          telefono: string | null
          ultima_compra: string | null
        }
        Relationships: []
      }
      sales_invoice_gaps: {
        Row: {
          branch_id: number | null
          fecha_siguiente: string | null
          gap_count: number | null
          gap_from: number | null
          gap_to: number | null
          siguiente_correlativo: string | null
          tipo_documento: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_invoice_nulls: {
        Row: {
          branch_id: number | null
          campos_nulos: string[] | null
          correlativo: string | null
          erp_invoice_id: string | null
          estado: string | null
          fecha: string | null
          id: number | null
        }
        Insert: {
          branch_id?: number | null
          campos_nulos?: never
          correlativo?: string | null
          erp_invoice_id?: string | null
          estado?: string | null
          fecha?: string | null
          id?: number | null
        }
        Update: {
          branch_id?: number | null
          campos_nulos?: never
          correlativo?: string | null
          erp_invoice_id?: string | null
          estado?: string | null
          fecha?: string | null
          id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventario_disponible: {
        Row: {
          en_vuelo: number | null
          erp_product_id: number | null
          erp_sucursal_id: number | null
          unidades: number | null
          unidades_sistema: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventario_disponible_vencidos: {
        Row: {
          en_vuelo: number | null
          erp_product_id: number | null
          erp_sucursal_id: number | null
          unidades: number | null
          unidades_sistema: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      v_inventario_lotes: {
        Row: {
          cantidad: number | null
          descripcion: string | null
          detalle: string | null
          erp_product_id: number | null
          erp_sucursal_id: number | null
          factor: number | null
          fecha_vencimiento: string | null
          id: number | null
          is_vencidos: boolean | null
          lote: string | null
          presentacion: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_erp_product_id_fkey"
            columns: ["erp_product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      v_product_factor: {
        Row: {
          factor: number | null
          id_presentacion: number | null
          pres_key: string | null
          pres_tipo: string | null
          product_id: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_precios_id_presentacion_fkey"
            columns: ["id_presentacion"]
            isOneToOne: false
            referencedRelation: "presentaciones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_presentations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_with_lab"
            referencedColumns: ["id"]
          },
        ]
      }
      v_sync_health: {
        Row: {
          branch_id: number | null
          checked_at: string | null
          domain: string | null
          erp_sucursal_id: number | null
          error_msg: string | null
          source: string | null
          success: boolean | null
        }
        Relationships: []
      }
      ventas_sin_producto: {
        Row: {
          branch_id: number | null
          cliente: string | null
          cod_vendedor: string | null
          correlativo: string | null
          customer_id: number | null
          fecha: string | null
          hora: string | null
          invoice_id: number | null
          motivo: string | null
          tipo_documento: string | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "dte_rechazos_vigentes"
            referencedColumns: ["customer_id"]
          },
        ]
      }
    }
    Functions: {
      _docs_sin_numero_control: {
        Args: never
        Returns: {
          codigo_generacion: string
          fecha: string
          id: number
        }[]
      }
      abonar_diferencia_corte: {
        Args: { p_abonos: Json; p_diferencia_id: number }
        Returns: Json
      }
      abrir_captura_de_foto: { Args: { p_employee_id?: string }; Returns: Json }
      activar_promocion: {
        Args: { p_activar?: boolean; p_id: number }
        Returns: Json
      }
      actualizar_extra_de_pedido: {
        Args: {
          p_cantidad: number
          p_factor: number
          p_item_id: number
          p_nota?: string
          p_tipo?: string
        }
        Returns: undefined
      }
      adjuntar_comprobante_deposito: {
        Args: { p_id: number; p_url: string }
        Returns: {
          anulado_at: string | null
          anulado_motivo: string | null
          anulado_por: string | null
          aporte: number
          aporte_nota: string | null
          banco_id: number | null
          cerrado_at: string
          cerrado_por: string | null
          comprobante_url: string | null
          created_at: string
          destino: string
          entregado_a: string | null
          fecha: string
          folio: string
          id: number
          llevado_por: string | null
          monto_deposito: number
          monto_efectivo: number
          nota: string | null
          remanente: number
          remanente_entregado_por: string | null
          remanente_recibido_por: string | null
          total_contado: number
        }
        SetofOptions: {
          from: "*"
          to: "depositos_bancarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      agregar_extra_a_pedido: {
        Args: {
          p_cantidad: number
          p_erp_product_id: number
          p_factor?: number
          p_nota?: string
          p_pedido_id: string
          p_sucursal_id: number
          p_tipo?: string
        }
        Returns: number
      }
      agregar_item_conteo: {
        Args: {
          p_conteo_id: string
          p_erp_product_id: number
          p_fecha_vencimiento?: string
          p_lote: string
          p_presentacion: string
        }
        Returns: Json
      }
      agregar_renglones_a_promocion: {
        Args: { p_id: number; p_renglones: Json }
        Returns: Json
      }
      ajustar_resumen_promocion: {
        Args: { p_id: number; p_salas: boolean; p_supervision: boolean }
        Returns: Json
      }
      alcance_de_ventas: { Args: never; Returns: Record<string, unknown> }
      alcance_escritura_ficha: {
        Args: { p_categoria: string }
        Returns: string
      }
      alertar_barrido_dte: { Args: never; Returns: undefined }
      anular_abono_diferencia: {
        Args: { p_id: number; p_motivo: string }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          created_at: string
          diferencia_id: number
          employee_id: string
          id: number
          impreso_at: string | null
          monto: number
          movimiento_id: number | null
          persona_id: number
          registrado_at: string
          registrado_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja_diferencia_abonos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      anular_bolsa: {
        Args: { p_id: number; p_motivo: string }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          caja: string | null
          cerrada_at: string
          cerrada_por: string | null
          contado: number | null
          contado_at: string | null
          contado_por: string | null
          conteo_id: number | null
          conteo_marcado: number | null
          conteo_marcado_at: string | null
          conteo_marcado_por: string | null
          corte_id: number | null
          created_at: string
          deposito_id: number | null
          dif_at: string | null
          dif_causa: string | null
          dif_foto_url: string | null
          dif_por: string | null
          dif_via: string | null
          entrega_id: number | null
          entregada_at: string | null
          entregada_por: string | null
          estado: string
          etiqueta_impresa_at: string | null
          etiqueta_version: number
          fecha: string
          folio: string
          hora: string
          id: number
          monto_inicial: number
          motivo_origen: string | null
          origen: string
          recibida_at: string | null
          recibida_por: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      anular_carne_temporal: { Args: { p_id: number }; Returns: Json }
      anular_creditos_ausentes: {
        Args: {
          p_branch_id: number
          p_desde: string
          p_hasta: string
          p_vistos: string[]
        }
        Returns: number
      }
      anular_deposito: {
        Args: { p_id: number; p_motivo: string }
        Returns: {
          anulado_at: string | null
          anulado_motivo: string | null
          anulado_por: string | null
          aporte: number
          aporte_nota: string | null
          banco_id: number | null
          cerrado_at: string
          cerrado_por: string | null
          comprobante_url: string | null
          created_at: string
          destino: string
          entregado_a: string | null
          fecha: string
          folio: string
          id: number
          llevado_por: string | null
          monto_deposito: number
          monto_efectivo: number
          nota: string | null
          remanente: number
          remanente_entregado_por: string | null
          remanente_recibido_por: string | null
          total_contado: number
        }
        SetofOptions: {
          from: "*"
          to: "depositos_bancarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      anular_diferencia_corte: {
        Args: { p_id: number; p_motivo: string }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          causa: string
          corte_id: number
          created_at: string
          evidencia_foto_url: string | null
          evidencia_ref: string | null
          fecha: string
          id: number
          impreso_at: string | null
          monto: number
          registrado_at: string
          registrado_por: string | null
          updated_at: string
          via: string
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja_diferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      anular_dispensacion: {
        Args: {
          p_detalle?: string
          p_dispensacion_id: number
          p_motivo: string
        }
        Returns: Json
      }
      anular_limpieza_bitacora: {
        Args: { p_limpieza_id: number; p_motivo: string }
        Returns: undefined
      }
      anular_metas_gasto: {
        Args: { p_id: number; p_nota: string }
        Returns: Json
      }
      anular_pago_compra: {
        Args: { p_motivo: string; p_pago_id: number }
        Returns: undefined
      }
      anular_pedido: {
        Args: { p_anulado_por?: string; p_motivo?: string; p_pedido_id: string }
        Returns: undefined
      }
      anular_receta: {
        Args: { p_motivo: string; p_receta_id: number }
        Returns: number
      }
      anular_salida_de_bolsa: {
        Args: { p_motivo: string; p_operacion_id: number }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          created_at: string
          entidad: string | null
          folio: string
          foto_lectura: Json | null
          foto_url: string | null
          id: number
          monto: number
          monto_origen: string | null
          nota: string | null
          numero_boleta: string | null
          recibido_metodo: string | null
          recibido_por: string | null
          registrado_at: string
          registrado_por: string | null
          tipo: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas_operaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apagar_cuenta_de_carne_temporal: {
        Args: { p_auth_user_id: string }
        Returns: undefined
      }
      aperturas_de_la_manana: { Args: { p_fecha?: string }; Returns: Json }
      aplicar_barrido_proveedores: {
        Args: { p_crear_supplier?: boolean; p_rows: Json }
        Returns: Json
      }
      aplicar_documentos_pendientes: {
        Args: { p_employee_id: string }
        Returns: Json
      }
      aplicar_espejo_erp: { Args: { p_filas: Json }; Returns: Json }
      aplicar_horarios_bitacora: {
        Args: { p_branch_id: number; p_franjas?: Json; p_limpiezas?: Json }
        Returns: number
      }
      apply_proveedores_categoria_sugerida: {
        Args: { p_ids: number[] }
        Returns: number
      }
      approve_minmax_request: {
        Args: { p_decided_by?: string; p_note?: string; p_request_id: number }
        Returns: Json
      }
      approve_minmax_requests_bulk: {
        Args: { p_decided_by?: string; p_request_ids: number[] }
        Returns: Json
      }
      aprobar_bono_semestral: {
        Args: { p_aprobar?: boolean; p_nota?: string; p_semestre: string }
        Returns: Json
      }
      aprobar_conteo_inventario: {
        Args: { p_conteo_id: string; p_nota?: string }
        Returns: Json
      }
      aprobar_meta_gerente: {
        Args: { p_id: number; p_monto?: number }
        Returns: undefined
      }
      aprobar_meta_por_autorizacion: {
        Args: {
          p_autorizo: string
          p_id: number
          p_monto?: number
          p_nota?: string
        }
        Returns: undefined
      }
      aprobar_metas_lote: { Args: { p_ids: number[] }; Returns: number }
      aprobar_metas_por_autorizacion_lote: {
        Args: { p_autorizo: string; p_ids: number[]; p_nota: string }
        Returns: number
      }
      aprobar_pago_compra: { Args: { p_pago_id: number }; Returns: undefined }
      asentar_diferencias_corte: {
        Args: { p_abono_ids?: number[]; p_ids: number[]; p_ref: string }
        Returns: Json
      }
      asignar_documento_a_empleados: {
        Args: { p_documento: Json; p_employee_ids: string[] }
        Returns: Json
      }
      audit_log_de_producto: {
        Args: {
          p_actions: string[]
          p_sucursal_id?: string
          p_target_id: string
        }
        Returns: Json
      }
      audit_log_de_sucursal: { Args: { p_branch_id: string }; Returns: Json }
      auth_can_edit_any: { Args: { p_modules: string[] }; Returns: boolean }
      auth_can_edit_scope_all: {
        Args: { p_modules: string[] }
        Returns: boolean
      }
      auth_employee_branch_id: { Args: never; Returns: number }
      auth_employee_erp_sucursal_id: { Args: never; Returns: number }
      auth_employee_id: { Args: never; Returns: string }
      auth_employee_role_id: { Args: never; Returns: number }
      auth_employee_secondary_role_id: { Args: never; Returns: number }
      auth_es_supervision: { Args: never; Returns: boolean }
      auth_has_module_permission: {
        Args: { p_action: string; p_module_key: string }
        Returns: boolean
      }
      auth_hereda_por_ausencia: {
        Args: { p_action: string; p_module_key: string }
        Returns: boolean
      }
      auth_is_su: { Args: never; Returns: boolean }
      auth_module_locked: { Args: { p_modules: string[] }; Returns: boolean }
      auth_module_scope: { Args: { p_module_key: string }; Returns: string }
      auth_no_bloqueado: { Args: never; Returns: boolean }
      auth_rango: { Args: never; Returns: number }
      auth_ve_costos: { Args: never; Returns: boolean }
      avisar_a_empleados: {
        Args: {
          p_body?: string
          p_branch_id?: number
          p_link?: string
          p_metadata?: Json
          p_push?: boolean
          p_recipients: string[]
          p_title: string
          p_type: string
        }
        Returns: number
      }
      avisar_a_sucursal: {
        Args: {
          p_body?: string
          p_branch_id: number
          p_link?: string
          p_metadata?: Json
          p_push?: boolean
          p_title: string
          p_type: string
        }
        Returns: number
      }
      avisar_aperturas_de_la_manana: {
        Args: {
          p_fecha?: string
          p_forzado?: boolean
          p_sin_respuesta?: number[]
        }
        Returns: number
      }
      avisar_cambios_que_no_se_quedaron: {
        Args: { p_horas?: number }
        Returns: number
      }
      avisar_cierre_del_dia: {
        Args: { p_fecha?: string; p_forzado?: boolean }
        Returns: number
      }
      avisar_cortes_pendientes: { Args: never; Returns: number }
      avisar_dias_sin_cierre: { Args: { p_fecha: string }; Returns: number }
      avisar_diferencia_de_ayer: { Args: { p_fecha?: string }; Returns: number }
      avisar_diferencias_pendientes_a_jefes: {
        Args: { p_solo?: string[] }
        Returns: number
      }
      avisar_diferencias_vencidas: { Args: never; Returns: Json }
      avisar_dui_por_vencer: { Args: { p_dias_antes?: number }; Returns: Json }
      avisar_envios_sin_decidir: { Args: { p_dias?: number }; Returns: number }
      avisar_estados_de_venta_desconocidos: { Args: never; Returns: number }
      avisar_facturas_de_sala: { Args: never; Returns: number }
      avisar_falla_del_consejo: {
        Args: { p_detalle?: string }
        Returns: boolean
      }
      avisar_faltantes: {
        Args: { p_actor: string; p_ids: string[]; p_request_id: string }
        Returns: number
      }
      avisar_faltantes_sin_resolver: {
        Args: { p_dias?: number }
        Returns: number
      }
      avisar_productos_sin_venta: {
        Args: { p_muestra_a?: string }
        Returns: number
      }
      avisar_rechazos_sin_arreglo: { Args: never; Returns: number }
      avisar_solicitudes_datos_por_vencer: { Args: never; Returns: number }
      avisar_traslados_por_respaldo: { Args: never; Returns: number }
      aviso_de_pedido_fallo: {
        Args: { p_err: string; p_pedido: string; p_que: string }
        Returns: undefined
      }
      aviso_ventana: {
        Args: { p_employee: string; p_ts?: string }
        Returns: string
      }
      avisos_entregar_diferidos: { Args: never; Returns: Json }
      avisos_filtrar_push: {
        Args: { p_ids: string[]; p_payload: Json }
        Returns: string[]
      }
      backfill_daily_stats_chunk: { Args: never; Returns: string }
      backup_dump_table: { Args: { p_table: string }; Returns: Json }
      bitacora_ahora_sv: { Args: never; Returns: string }
      bitacora_estado_franja: {
        Args: {
          p_desde: string
          p_fecha: string
          p_hasta: string
          p_hay_registro: boolean
        }
        Returns: string
      }
      bitacora_exigir_acceso: {
        Args: { p_accion?: string; p_branch_id: number }
        Returns: undefined
      }
      bitacora_hoy_sv: { Args: never; Returns: string }
      bitacora_libro_pendientes: {
        Args: { p_branch_id: number; p_periodo: string }
        Returns: number
      }
      bitacora_pendientes_por_vencer: {
        Args: { p_minutos?: number }
        Returns: {
          areas: string
          branch_id: number
          branch_name: string
          cierra: string
          detalle: Json
          fecha: string
          lecturas: number
          limpiezas: number
          minutos: number
          pendientes: number
        }[]
      }
      bitacora_periodo_cerrado: {
        Args: { p_branch_id: number; p_periodo: string }
        Returns: boolean
      }
      bitacora_tomar_folio: {
        Args: { p_anio: number; p_branch_id: number; p_serie?: string }
        Returns: number
      }
      block_employee: {
        Args: { p_employee_id: string; p_reason?: string; p_until?: string }
        Returns: number
      }
      boleta_ya_en_caja: {
        Args: { p_branch_id: number; p_numero_boleta: string }
        Returns: Json
      }
      boleta_ya_registrada: {
        Args: { p_branch_id: number; p_numero_boleta: string }
        Returns: Json
      }
      bolsa_reintegro_maximo: { Args: { p_bolsa_id: number }; Returns: number }
      bolsa_saldo: { Args: { p_bolsa_id: number }; Returns: number }
      bolsa_saldo_para_el_corte: {
        Args: { p_bolsa_id: number; p_hasta: string }
        Returns: number
      }
      bolsa_sugerida: { Args: { p_corte_id: number }; Returns: number }
      bolsas_circuito_desde: { Args: never; Returns: string }
      bolsas_invariante_desde: { Args: never; Returns: string }
      bono_meta_sala_interno: {
        Args: { p_branch_id: number; p_year_month: string }
        Returns: Json
      }
      bono_semestre_asegurar: {
        Args: { p_semestre: string }
        Returns: {
          aprobado_at: string | null
          aprobado_por: string | null
          created_at: string
          estado: string
          id: number
          nota: string | null
          semestre: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bono_semestre"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bonos_producto_items: {
        Args: never
        Returns: {
          branch_id: number
          employee_id: string
          excedente_id: number
          item: string
          monto: number
          promocion: string
          promocion_id: number
          tipo: string
          unidades: number
        }[]
      }
      borrar_promocion: { Args: { p_id: number }; Returns: Json }
      buscar_clientes_ids: {
        Args: { p_limite?: number; p_q: string }
        Returns: Json
      }
      buscar_empleado_para_solicitud: {
        Args: { p_dui?: string; p_nombre?: string; p_telefono?: string }
        Returns: {
          address: string
          birth_date: string
          code: string
          dui: string
          email: string
          id: string
          name: string
          phone: string
          status: string
        }[]
      }
      buscar_facturas_sala_ids: {
        Args: {
          p_branch_id: number
          p_codigos?: string[]
          p_desde: string
          p_hasta: string
          p_limite?: number
          p_q: string
        }
        Returns: Json
      }
      buscar_inventario_global: { Args: { p_search: string }; Returns: Json }
      buscar_inventario_global_v2: {
        Args: { p_max_productos?: number; p_search: string }
        Returns: Json
      }
      buscar_medicos_ids: {
        Args: { p_junta?: string; p_q: string; p_tope?: number }
        Returns: Json
      }
      buscar_o_crear_medico: {
        Args: {
          p_carrera?: string
          p_junta?: string
          p_nombre: string
          p_numero_junta: string
          p_origen?: string
          p_verificado?: boolean
        }
        Returns: number
      }
      buscar_personas_por_nombre: { Args: { p_nombre: string }; Returns: Json }
      buscar_productos_ids: {
        Args: {
          p_con_laboratorio?: boolean
          p_con_pactivo?: boolean
          p_limite?: number
          p_q: string
          p_solo_activos?: boolean
        }
        Returns: Json
      }
      buscar_productos_minmax: {
        Args: { p_limit?: number; p_search: string }
        Returns: Json
      }
      busqueda_base: { Args: { p: string; p_partir: boolean }; Returns: string }
      busqueda_clientes: {
        Args: { p_q: string }
        Returns: {
          aproximado: boolean
          id: number
          puntaje: number
        }[]
      }
      busqueda_coincide: {
        Args: { p_palabras: Json; p_texto: string }
        Returns: boolean
      }
      busqueda_distancia: { Args: { a: string; b: string }; Returns: number }
      busqueda_fonetica: { Args: { p: string }; Returns: string }
      busqueda_la_mas_larga: { Args: { p_pats: string[] }; Returns: string }
      busqueda_palabras: { Args: { p_q: string }; Returns: Json }
      busqueda_parecido: {
        Args: { p_campos: string[]; p_compactas: string[]; p_palabras: Json }
        Returns: number
      }
      busqueda_patrones_legados: {
        Args: { p_palabras: Json }
        Returns: string[]
      }
      busqueda_prefiltro: { Args: { p_palabras: Json }; Returns: string[] }
      busqueda_productos: {
        Args: {
          p_con_aproximada?: boolean
          p_con_laboratorio?: boolean
          p_con_pactivo?: boolean
          p_q: string
          p_solo_activos?: boolean
        }
        Returns: {
          aproximado: boolean
          id: number
          puntaje: number
        }[]
      }
      busqueda_puntaje: {
        Args: { p_campos: string[]; p_compactas: string[]; p_palabras: Json }
        Returns: number
      }
      caja_cierre_automatico_anotar: {
        Args: {
          p_branch_id: number
          p_corte_hora: string
          p_detalle: Json
          p_erp_corte_id: number
          p_falta: number
          p_fecha: string
          p_motivo: string
          p_resultado: string
        }
        Returns: undefined
      }
      caja_cierre_automatico_decidir: {
        Args: { p_branch_id: number; p_momento?: string }
        Returns: Json
      }
      caja_cierre_automatico_salas: {
        Args: { p_momento?: string }
        Returns: Json
      }
      caja_efectivo_piezas: {
        Args: { p_apertura?: number; p_branch_id: number; p_dia: string }
        Returns: Json
      }
      caja_estado: { Args: { p_branch_id: number }; Returns: Json }
      caja_falta_contra_corte: {
        Args: {
          p_branch_id: number
          p_corte_id: number
          p_dia: string
          p_piezas?: Json
        }
        Returns: Json
      }
      caja_falta_por_contar: {
        Args: { p_branch_id: number; p_dia: string; p_piezas?: Json }
        Returns: Json
      }
      caja_vales_pendientes: {
        Args: never
        Returns: {
          branch_id: number
          dia_abierto: string
          folio: string
          monto: number
          movimiento_id: number
          operacion_id: number
          sala: string
        }[]
      }
      calc_credito_declarable: {
        Args: { p_desde: string; p_hasta: string }
        Returns: number
      }
      calculate_stock_params: {
        Args: { p_erp_sucursal_id?: number }
        Returns: Json
      }
      cancelar_envio: {
        Args: { p_motivo: string; p_request_id: string }
        Returns: boolean
      }
      canjear_codigo_de_vinculacion: {
        Args: { p_codigo: string; p_equipo?: string; p_impresora?: string }
        Returns: {
          device_id: string
          device_token: string
          nombre: string
          sala: string
        }[]
      }
      cantidad_de_diferencia: { Args: { p_item_id: number }; Returns: number }
      captura_de_foto_vigente: { Args: { p_secreto: string }; Returns: Json }
      cargos_de_administracion: { Args: never; Returns: string[] }
      carne_disponible: {
        Args: { p_code: string; p_excluir?: string }
        Returns: boolean
      }
      cerrar_bolsa_de_corte: {
        Args: { p_corte_id: number; p_monto_esperado: number }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          caja: string | null
          cerrada_at: string
          cerrada_por: string | null
          contado: number | null
          contado_at: string | null
          contado_por: string | null
          conteo_id: number | null
          conteo_marcado: number | null
          conteo_marcado_at: string | null
          conteo_marcado_por: string | null
          corte_id: number | null
          created_at: string
          deposito_id: number | null
          dif_at: string | null
          dif_causa: string | null
          dif_foto_url: string | null
          dif_por: string | null
          dif_via: string | null
          entrega_id: number | null
          entregada_at: string | null
          entregada_por: string | null
          estado: string
          etiqueta_impresa_at: string | null
          etiqueta_version: number
          fecha: string
          folio: string
          hora: string
          id: number
          monto_inicial: number
          motivo_origen: string | null
          origen: string
          recibida_at: string | null
          recibida_por: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cerrar_dato_pedido: {
        Args: {
          p_actor?: string
          p_id: string
          p_nota?: string
          p_valor: string
        }
        Returns: Json
      }
      cerrar_despacho_envio: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      cerrar_envio: {
        Args: {
          p_actor: string
          p_motivos?: string
          p_nota?: string
          p_request_id: string
          p_status: string
        }
        Returns: boolean
      }
      cerrar_faltante: {
        Args: { p_estado: string; p_id: string; p_nota?: string }
        Returns: Json
      }
      cerrar_item_por_devolucion: {
        Args: { p_actor: string; p_devolucion_id: string }
        Returns: undefined
      }
      cerrar_mes_bitacora: {
        Args: {
          p_branch_id: number
          p_observaciones?: string
          p_periodo: string
        }
        Returns: number
      }
      cerrar_no_reenviadas: {
        Args: {
          p_actor: string
          p_labels: string[]
          p_pedido_id: string
          p_suc_id: number
        }
        Returns: Json
      }
      cerrar_pedido_si_todo_resuelto: {
        Args: { p_actor: string; p_pedido_id: string; p_suc_id: number }
        Returns: undefined
      }
      cerrar_periodo_fiscal: {
        Args: { p_declarado_real?: number; p_nota?: string; p_periodo: string }
        Returns: Json
      }
      cerrar_traslado_ya_recibido: {
        Args: { p_id_traslado: string; p_msg?: string; p_request_id: string }
        Returns: boolean
      }
      clase_de_cliente: {
        Args: { p_customer_id: number; p_texto: string }
        Returns: string
      }
      clase_de_dispensacion: {
        Args: { p_erp_product_id: number }
        Returns: string
      }
      clasificar_observacion_mh: {
        Args: { p_texto: string }
        Returns: {
          accionable: boolean
          campo_ficha: string
          familia: string
          ruta: string
        }[]
      }
      classify_purchase_dte_review: {
        Args: {
          p_document_id: number
          p_motivo?: string
          p_review_id: number
          p_tipo: string
        }
        Returns: undefined
      }
      clave_movimiento_de_item: {
        Args: { p_item_id: number; p_prefijo: string }
        Returns: string
      }
      clientes_anotar_nacimiento: { Args: { p_filas: Json }; Returns: number }
      clientes_sin_distrito_corregibles: {
        Args: never
        Returns: {
          categoria: string
          departamento: string
          direccion: string
          erp_id: string
          id: number
          municipio: string
          name: string
        }[]
      }
      close_ventas_month: { Args: { p_mes: string }; Returns: undefined }
      cobros_portal_en_efectivo: {
        Args: { p_branch: number; p_fecha: string; p_hasta: string }
        Returns: number
      }
      cola_espejo_portal_erp: { Args: { p_limite?: number }; Returns: Json }
      compactar_busqueda: { Args: { p: string }; Returns: string }
      completar_dispensacion: {
        Args: {
          p_cantidad_prescrita: number
          p_dispensacion_id: number
          p_fecha_prescripcion?: string
          p_foto_url?: string
          p_medico_id: number
          p_motivo_pendiente?: string
          p_notas?: string
          p_paciente_documento?: string
          p_paciente_edad?: number
          p_paciente_nombre: string
          p_receta_id?: number
        }
        Returns: Json
      }
      completar_nit_proveedores: {
        Args: { p_pares: Json }
        Returns: {
          nit: string
          resultado: string
          supplier_id: number
        }[]
      }
      confirm_pedido: {
        Args: {
          p_created_by: string
          p_items: Json
          p_notes: string
          p_responsable_id?: string
          p_revisado_por?: string
          p_sucursal_ids?: number[]
        }
        Returns: string
      }
      confirmar_alias_producto: {
        Args: {
          p_codigo_prov: string
          p_emisor_nit: string
          p_product_id: number
        }
        Returns: undefined
      }
      confirmar_clasificacion_propuesta: {
        Args: { p_ids: number[] }
        Returns: number
      }
      confirmar_conteo: { Args: { p_ids: number[] }; Returns: number }
      confirmar_envio_pedido: {
        Args: { p_ajustes?: Json; p_pedido_id: string; p_sucursal_id: number }
        Returns: Json
      }
      confirmar_impresion: {
        Args: {
          p_device: string
          p_error?: string
          p_id: number
          p_ok: boolean
          p_token: string
        }
        Returns: undefined
      }
      confirmar_llegada_diferencia: {
        Args: { p_item_id: number; p_nota?: string }
        Returns: Json
      }
      confirmar_meta_supervisor: {
        Args: { p_id: number; p_monto?: number; p_nota?: string }
        Returns: undefined
      }
      confirmar_metas_lote: { Args: { p_items: Json }; Returns: number }
      congelar_metas_mes: {
        Args: { p_forzar?: boolean; p_year_month: string }
        Returns: number
      }
      consumir_vale_de_identidad: {
        Args: { p_persona: string; p_vale: string }
        Returns: string
      }
      contar_inventario_por_vencer: {
        Args: {
          p_en30: string
          p_en7: string
          p_erp_sucursal_id: number
          p_hoy: string
        }
        Returns: Json
      }
      conteo_busqueda_aproximada: {
        Args: { p_conteo_id: string; p_search: string }
        Returns: number[]
      }
      conteo_costo_unitario: {
        Args: { p_presentacion: string; p_product_id: number }
        Returns: number
      }
      conteo_grupo_key: {
        Args: { p_presentacion: string; p_product_id: number }
        Returns: string
      }
      conteo_lineas_netas: {
        Args: { p_conteo_id: string }
        Returns: {
          costo_neto: number
          factor: number
          grupo_id: string
          grupo_mixto: boolean
          item_id: string
          mult: number
          neto_grupo: number
        }[]
      }
      conteo_puede_ver_sistema: {
        Args: { p_conteo_id: string }
        Returns: boolean
      }
      contexto_de_solicitud_minmax: {
        Args: { p_erp_product_id: number; p_erp_sucursal_id: number }
        Returns: Json
      }
      corregir_lectura_bitacora: {
        Args: {
          p_accion: string
          p_humedad: number
          p_lectura_id: number
          p_motivo: string
          p_temperatura: number
        }
        Returns: undefined
      }
      corregir_limpieza_bitacora: {
        Args: {
          p_limpieza_id: number
          p_motivo?: string
          p_observaciones?: string
          p_puntos?: Json
        }
        Returns: undefined
      }
      corregir_recepcion_de_item: {
        Args: { p_cantidad: number; p_item_id: number; p_nota?: string }
        Returns: Json
      }
      corte_diferencia: {
        Args: {
          p_cobros_portal: number
          p_cobros_tk: number
          p_declarado: number
          p_dif_erp: number
          p_subtotal: number
          p_total_caja: number
          p_vales: number
        }
        Returns: number
      }
      corte_no_conto_efectivo: {
        Args: {
          p_declarado: number
          p_dif_erp: number
          p_tipo: string
          p_total_caja: number
        }
        Returns: boolean
      }
      corte_trabado_por_posterior: {
        Args: { p_corte_id: number }
        Returns: undefined
      }
      corte_tramo: { Args: { p_corte_id: number }; Returns: number }
      corte_vendedores_del_tramo: {
        Args: { p_corte_id: number }
        Returns: {
          employee_id: string
          ventas: number
        }[]
      }
      count_docs_sin_numero_control: { Args: never; Returns: number }
      crear_clientes_faltantes: { Args: { p_filas: Json }; Returns: number }
      crear_codigo_de_vinculacion: {
        Args: { p_branch_id: number; p_nombre: string }
        Returns: {
          codigo: string
          expira: string
          id: string
        }[]
      }
      crear_conteo_inventario: {
        Args: {
          p_branch_id: number
          p_erp_product_ids?: number[]
          p_fuente_sistema?: string
          p_modo?: string
          p_scope_filter?: Json
          p_scope_type: string
        }
        Returns: string
      }
      crear_conteos_ciclicos_programados: { Args: never; Returns: Json }
      crear_metas_gasto: {
        Args: {
          p_concepto: string
          p_meses: number
          p_nota?: string
          p_salas: Json
          p_ym_inicio: string
        }
        Returns: Json
      }
      crear_promocion: {
        Args: { p_nombre: string; p_nota?: string; p_renglones: Json }
        Returns: Json
      }
      crear_promocion_laboratorio: {
        Args: {
          p_laboratorios: number[]
          p_niveles: Json
          p_nombre: string
          p_nota?: string
          p_paga?: string
          p_supplier_id?: number
          p_umbrales: Json
          p_year_month: string
        }
        Returns: Json
      }
      crear_ruta: {
        Args: {
          p_conductor_id: string
          p_conductor_nombre: string
          p_creado_por?: string
          p_distancia_total_m?: number
          p_duracion_min?: number
          p_paradas: Json
        }
        Returns: string
      }
      crear_solicitud_datos: {
        Args: { p_branch_id: number }
        Returns: {
          anio: number
          branch_id: number | null
          created_at: string
          derechos: string[]
          descripcion: string | null
          estado: string
          folio: number
          folio_txt: string | null
          id: string
          identidad_cotejada_por: string | null
          identidad_documento: string | null
          identidad_numero: string | null
          impresa_at: string
          impresa_por: string | null
          motivo_negativa: string | null
          negada: boolean
          notas: string | null
          por_representacion: boolean
          prevencion: string | null
          prevenida_at: string | null
          prorrogada_at: string | null
          recibida_at: string | null
          recibida_por: string | null
          representacion_doc: string | null
          resolucion: string | null
          resuelta_at: string | null
          resuelta_por: string | null
          solicitante_correo: string | null
          solicitante_direccion: string | null
          solicitante_documento: string | null
          solicitante_nombre: string | null
          solicitante_numero: string | null
          solicitante_telefono: string | null
          updated_at: string
          via_respuesta: string | null
        }
        SetofOptions: {
          from: "*"
          to: "solicitudes_datos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      credito_detalle: { Args: { p_id: number }; Returns: Json }
      creditos_del_cliente: {
        Args: { p_credito_id: number }
        Returns: {
          abonado: number
          branch_id: number
          credito: string
          dias: number
          documento: string
          fecha: string
          id: number
          saldo: number
          total: number
        }[]
      }
      creditos_pasados_del_plazo: {
        Args: { p_dias?: number }
        Returns: {
          branch_id: number
          cliente: string
          credito_erp: string
          customer_id: number
          dias: number
          fecha: string
          id: number
          sala: string
          saldo: number
          vendedor: string
          vendedor_id: string
        }[]
      }
      cron_auth_headers: { Args: never; Returns: Json }
      cuenta_de_carne_temporal: { Args: { p_email: string }; Returns: string }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      customer_ficha_estado: {
        Args: {
          p_categoria: string
          p_direccion: string
          p_dui: string
          p_giro: string
          p_nit: string
          p_nrc: string
          p_pasaporte: string
          p_phone: string
        }
        Returns: string
      }
      datos_pedidos_de_mi_sala: { Args: never; Returns: Json }
      decidir_bono_semestral: {
        Args: {
          p_employee_id: string
          p_motivo: string
          p_pagar: boolean
          p_semestre: string
        }
        Returns: Json
      }
      decidir_devolucion_pedido: {
        Args: { p_accion: string; p_id: string; p_nota?: string }
        Returns: Json
      }
      decidir_diferencia_pedido: {
        Args: {
          p_accion: string
          p_evidencia?: Json
          p_item_id: number
          p_nota?: string
          p_tipo?: string
        }
        Returns: Json
      }
      decidir_excedente: {
        Args: { p_aprobar: boolean; p_id: number; p_motivo?: string }
        Returns: Json
      }
      declarar_faltante_tardio: {
        Args: { p_faltantes: Json; p_request_id: string }
        Returns: Json
      }
      declarar_faltantes: {
        Args: { p_actor: string; p_faltantes: Json; p_request_id: string }
        Returns: Json
      }
      dejar_documento_pendiente: {
        Args: { p_documento: Json; p_nombre: string }
        Returns: string
      }
      descartar_cliente_por_revisar: {
        Args: { p_deshacer?: boolean; p_id: number }
        Returns: undefined
      }
      desmarcar_conteo_bolsa: {
        Args: { p_id: number }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          caja: string | null
          cerrada_at: string
          cerrada_por: string | null
          contado: number | null
          contado_at: string | null
          contado_por: string | null
          conteo_id: number | null
          conteo_marcado: number | null
          conteo_marcado_at: string | null
          conteo_marcado_por: string | null
          corte_id: number | null
          created_at: string
          deposito_id: number | null
          dif_at: string | null
          dif_causa: string | null
          dif_foto_url: string | null
          dif_por: string | null
          dif_via: string | null
          entrega_id: number | null
          entregada_at: string | null
          entregada_por: string | null
          estado: string
          etiqueta_impresa_at: string | null
          etiqueta_version: number
          fecha: string
          folio: string
          hora: string
          id: number
          monto_inicial: number
          motivo_origen: string | null
          origen: string
          recibida_at: string | null
          recibida_por: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      destinatarios_de_cortes: {
        Args: { p_branch_id: number }
        Returns: string[]
      }
      destinatarios_de_faltante: {
        Args: { p_excepto?: string; p_origen: number }
        Returns: string[]
      }
      destinatarios_de_modulo: {
        Args: { p_branch_id: number; p_module_key: string }
        Returns: string[]
      }
      detectar_proveedores_duplicados: {
        Args: never
        Returns: {
          clave: string
          fichas: Json
          motivo: string
        }[]
      }
      devolver_meta_gerente: {
        Args: { p_id: number; p_nota: string }
        Returns: undefined
      }
      discard_stock_drafts: {
        Args: { p_erp_sucursal_id: number }
        Returns: number
      }
      dui_disponible: {
        Args: { p_dui: string; p_excluir?: string }
        Returns: boolean
      }
      duplicar_promocion: {
        Args: { p_branch_id?: number; p_id: number; p_nombre: string }
        Returns: Json
      }
      editar_lote_conteo_item: {
        Args: {
          p_fecha_vencimiento?: string
          p_item_id: string
          p_lote: string
        }
        Returns: Json
      }
      editar_promocion_laboratorio: {
        Args: {
          p_id: number
          p_laboratorios: number[]
          p_niveles: Json
          p_nombre: string
          p_nota?: string
          p_paga?: string
          p_supplier_id?: number
          p_umbrales: Json
        }
        Returns: Json
      }
      editar_renglon: {
        Args: {
          p_borrar_lote?: boolean
          p_cualquier_pres?: boolean
          p_factor_unidades?: number
          p_lote_total?: number
          p_paga?: string
          p_renglon_id: number
          p_reparto?: Json
          p_supplier_id?: number
          p_tiene_bono?: boolean
        }
        Returns: Json
      }
      editar_reparto: {
        Args: { p_renglon_id: number; p_reparto: Json }
        Returns: Json
      }
      editar_tarifa_renglon: {
        Args: {
          p_bono_adm: number
          p_bono_bodega: number
          p_bono_vendedor: number
          p_desde?: string
          p_renglon_id: number
          p_unidades_por_bono?: number
        }
        Returns: Json
      }
      eliminar_caja_de_impresion: { Args: { p_id: string }; Returns: string }
      eliminar_conteo_inventario: {
        Args: { p_conteo_id: string }
        Returns: Json
      }
      emitir_carne_temporal: {
        Args: {
          p_employee_id: string
          p_impreso_en?: number
          p_motivo?: string
        }
        Returns: Json
      }
      emparejar_producto_dte: {
        Args: { p_codigo_prov: string; p_emisor_nit: string; p_texto: string }
        Returns: {
          nombre: string
          origen: string
          product_id: number
          similitud: number
        }[]
      }
      empleado_no_disponible: {
        Args: { p_employee_id: string }
        Returns: boolean
      }
      empleado_sala_de_hoy: {
        Args: { p_employee_id?: string; p_fecha?: string }
        Returns: number
      }
      empleados_en_turno: {
        Args: { p_branch_id: number }
        Returns: {
          employee_id: string
        }[]
      }
      empleados_por_rango: {
        Args: {
          p_branch_id?: number
          p_excluir?: string
          p_max?: number
          p_min: number
        }
        Returns: string[]
      }
      employee_esta_bloqueado: { Args: { p_user_id: string }; Returns: boolean }
      encolar_impresion: {
        Args: { p_branch_id: number; p_contenido: string; p_titulo: string }
        Returns: number
      }
      entregar_bolsas: {
        Args: { p_ids: number[]; p_recibido_por: string; p_vale: string }
        Returns: {
          branch_id: number
          confirmada_at: string | null
          confirmada_por: string | null
          created_at: string
          entregada_at: string
          entregada_por: string | null
          folio: string
          id: number
          recibido_metodo: string
          recibido_por: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas_entregas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      envio_json: { Args: { p_request_id: string }; Returns: Json }
      envios_json: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          j: Json
        }[]
      }
      envios_por_continuar: {
        Args: { p_minutos?: number }
        Returns: {
          desde: string
          faltan: number
          request_id: string
        }[]
      }
      es_busqueda_de_codigo: { Args: { p_search: string }; Returns: boolean }
      es_cliente_mostrador: {
        Args: { p_erp_id: string; p_name: string }
        Returns: boolean
      }
      es_despacho_adicional: {
        Args: {
          p_caja_especial: boolean
          p_dispatch_tipo: string
          p_tiene_label: boolean
        }
        Returns: boolean
      }
      es_dui_valido: { Args: { p_dui: string }; Returns: boolean }
      es_inyectable: { Args: { p_descripcion: string }; Returns: boolean }
      es_jefe_de_sala: {
        Args: { p_branch_id: number; p_employee_id: string }
        Returns: boolean
      }
      es_solicitud_operativa: { Args: { p_type: string }; Returns: boolean }
      es_telefono_sv_valido: { Args: { p_tel: string }; Returns: boolean }
      es_ultimo_dia_del_mes_sv: { Args: never; Returns: boolean }
      escalera_disciplinaria: {
        Args: { p_employee_id: string; p_falta: string; p_fecha?: string }
        Returns: Json
      }
      escribir_niveles_promocion: {
        Args: {
          p_id: number
          p_laboratorios: number[]
          p_niveles: Json
          p_umbrales: Json
        }
        Returns: undefined
      }
      espejo_valor: {
        Args: { p_actual: string; p_campo: string; p_erp: string; p_prot: Json }
        Returns: string
      }
      esta_suspendido: {
        Args: { p_employee_id: string; p_fecha?: string }
        Returns: boolean
      }
      etiquetas_factura_sala: {
        Args: { p_emisor_nit: string; p_items_norm: string }
        Returns: string
      }
      explicar_meta_propuesta: {
        Args: { p_branch_id: number; p_year_month: string }
        Returns: Json
      }
      explicar_metas_propuestas: {
        Args: { p_year_month: string }
        Returns: Json
      }
      extender_renglon: {
        Args: { p_fin: string; p_renglon_id: number }
        Returns: Json
      }
      extraer_observaciones_mh: { Args: { p_texto: string }; Returns: string[] }
      f_unaccent: { Args: { "": string }; Returns: string }
      factura_esta_anulada: { Args: { p_estado: string }; Returns: boolean }
      facturas_sala_guarda: {
        Args: { p_accion: string; p_branch_id: number }
        Returns: undefined
      }
      ficha_de_persona: { Args: { p_id: string }; Returns: string }
      fichas_para_corregir_dte: {
        Args: never
        Returns: {
          alcance_escritura: string
          campo: string
          categoria: string
          customer_id: number
          erp_id: string
          motivo_mh: string
          name: string
          origen: string
          ya_corregido: boolean
        }[]
      }
      finalizar_conteo_inventario: {
        Args: { p_conteo_id: string; p_pendientes_como_cero?: boolean }
        Returns: Json
      }
      find_purchase_dte_document_by_codigo: {
        Args: { p_codigo: string }
        Returns: Json
      }
      find_sync_gaps: {
        Args: { p_date: string; p_max_gap?: number }
        Returns: {
          gap_end: number
          gap_size: number
          gap_start: number
        }[]
      }
      formas_de_abono_en_efectivo: { Args: never; Returns: string[] }
      foto_de_empleado: { Args: { p_id: string }; Returns: string }
      fotografiar_bono_meta_mes: {
        Args: { p_origen?: string; p_year_month: string }
        Returns: number
      }
      fusionar_cliente_duplicado: {
        Args: { p_erp_id: string; p_huerfana: number }
        Returns: Json
      }
      generar_csv_libro: {
        Args: {
          p_branch_id: number
          p_desde: string
          p_hasta: string
          p_reporte: string
        }
        Returns: string[]
      }
      generar_propuestas_metas: {
        Args: { p_year_month: string }
        Returns: number
      }
      generar_propuestas_metas_manual: { Args: never; Returns: number }
      generate_wfm_snapshot: {
        Args: { p_branch_id: number }
        Returns: undefined
      }
      get_abonos_del_dia: {
        Args: { p_branch: number; p_fecha: string }
        Returns: Json
      }
      get_active_product_lab_counts: {
        Args: never
        Returns: {
          laboratorio_id: number
          product_count: number
        }[]
      }
      get_anexo_retencion_renta: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          base_sin_iva: number
          codigo_generacion: string
          fecha: string
          monto_total: number
          nit: string
          nrc: string
          numero_control: string
          proveedor: string
          retencion_10: number
          tipo_documento: string
        }[]
      }
      get_bitacora_dia: {
        Args: { p_branch_id: number; p_fecha: string }
        Returns: Json
      }
      get_bitacora_dispensaciones: {
        Args: {
          p_branch_id: number
          p_clase?: string
          p_desde: string
          p_estado?: string
          p_hasta: string
        }
        Returns: Json
      }
      get_bitacora_mes_impreso: {
        Args: { p_branch_id: number; p_periodo: string }
        Returns: Json
      }
      get_bitacora_resumen_mes: {
        Args: { p_branch_id: number; p_periodo: string }
        Returns: Json
      }
      get_bolsa_eventos: {
        Args: { p_bolsa_id: number }
        Returns: {
          accion: string
          created_at: string
          employee_id: string
          estado_antes: string
          estado_despues: string
          id: number
          monto: number
          motivo: string
          nombre: string
          nota: string
          photo_url: string
        }[]
      }
      get_bolsas_con_diferencia: { Args: never; Returns: Json }
      get_bolsas_invariante: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          bolsas: number
          branch_id: number
          declarado: number
          descuadre: number
          fecha: string
          suma_bolsas: number
        }[]
      }
      get_bolsas_personas: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          name: string
          photo_url: string
        }[]
      }
      get_bolsas_saldos: {
        Args: { p_ids: number[] }
        Returns: {
          bolsa_id: number
          saldo: number
          salidas: number
          vales: number
        }[]
      }
      get_bono_meta_sala: {
        Args: { p_branch_id: number; p_year_month: string }
        Returns: Json
      }
      get_bono_semestral: { Args: { p_semestre: string }; Returns: Json }
      get_bonos_producto_sala: { Args: { p_branch_id: number }; Returns: Json }
      get_caja_piezas_del_rango: {
        Args: { p_branch?: number; p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          fecha: string
          piezas: Json
        }[]
      }
      get_candidatos_retencion_renta: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          categoria: string
          documentos: number
          es_persona_natural: boolean
          identificacion: string
          monto: number
          nombre: string
          proveedor_id: number
          retiene_renta: boolean
        }[]
      }
      get_ccf_alerts: {
        Args: never
        Returns: {
          branch_id: number
          branch_name: string
          correlativo: string
          estado: string
          tipo: string
        }[]
      }
      get_ccf_con_problema: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          branch_name: string
          correlativo: string
          estado: string
          fecha: string
          invoice_id: number
          problemas: string[]
          total: number
        }[]
      }
      get_ccf_repaso: {
        Args: { p_modo: string }
        Returns: {
          alert_key: string
          branch_id: number
          branch_name: string
          correlativo: string
          estado: string
          fecha: string
          problemas: string[]
          total: number
        }[]
      }
      get_cheques_de_bolsa: { Args: { p_bolsa_id: number }; Returns: Json }
      get_clasificacion_fiscal_pendiente: { Args: never; Returns: Json }
      get_clientes_por_revisar: {
        Args: { p_familia?: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_consecutive_mh_alerts: {
        Args: never
        Returns: {
          branch_id: number
          branch_name: string
          first_correlativo: string
          run_len: number
        }[]
      }
      get_conteo_item_history: {
        Args: { p_item_id: string }
        Returns: {
          contado_at: string
          contado_por: string
          contado_por_nombre: string
          contado_por_photo_url: string
          diferencia: number
          estado_item: string
          evento: string
          fisico_cantidad: number
          id: string
          nota: string
          sistema_cantidad: number
        }[]
      }
      get_conteo_items_count: {
        Args: {
          p_conteo_id: string
          p_erp_product_id?: number
          p_filtro?: string
          p_search?: string
        }
        Returns: number
      }
      get_conteo_items_jsonb: { Args: { p_conteo_id: string }; Returns: Json }
      get_conteo_items_search: {
        Args: {
          p_area?: string
          p_conteo_id: string
          p_erp_product_id?: number
          p_erp_product_ids?: number[]
          p_filtro?: string
          p_limit?: number
          p_offset?: number
          p_search?: string
        }
        Returns: {
          contado_at: string
          contado_por: string
          contado_por_nombre: string
          contado_por_photo_url: string
          costo_unitario: number
          detalle: string
          diferencia: number
          diferencia_grupo: number
          ediciones_count: number
          erp_product_id: number
          es_agregado_manual: boolean
          es_antibiotico: boolean
          estado_item: string
          factor: number
          fecha_vencimiento: string
          fisico_cantidad: number
          fisico_primer_conteo: number
          foto_url: string
          grupo_mixto: boolean
          id: string
          is_vencidos: boolean
          laboratorio_nombre: string
          lote: string
          nota: string
          presentacion: string
          product_nombre: string
          recontado_at: string
          recontado_por: string
          recontado_por_nombre: string
          recontado_por_photo_url: string
          sistema_cantidad: number
          ver_sistema: boolean
        }[]
      }
      get_conteo_laboratorios: {
        Args: { p_conteo_id: string }
        Returns: {
          item_count: number
          laboratorio_id: number
          laboratorio_nombre: string
        }[]
      }
      get_conteo_products_count: {
        Args: {
          p_area?: string
          p_conteo_id: string
          p_filtro?: string
          p_laboratorio_id?: number
          p_search?: string
        }
        Returns: number
      }
      get_conteo_products_page: {
        Args: {
          p_area?: string
          p_conteo_id: string
          p_filtro?: string
          p_laboratorio_id?: number
          p_limit?: number
          p_offset?: number
          p_order_by?: string
          p_order_dir?: string
          p_search?: string
        }
        Returns: {
          con_diferencia_count: number
          con_proximos_count: number
          con_vencidos_count: number
          contados_count: number
          diferencia_total: number
          erp_product_id: number
          es_antibiotico: boolean
          fisico_total: number
          foto_url: string
          item_count: number
          laboratorio_nombre: string
          product_nombre: string
          sin_ubicar_count: number
          sistema_total: number
          total_en_unidades: boolean
          ver_sistema: boolean
        }[]
      }
      get_conteo_resumen: { Args: { p_conteo_id: string }; Returns: Json }
      get_conteos: { Args: { p_desde: string; p_hasta: string }; Returns: Json }
      get_conteos_valor: { Args: { p_ids: string[] }; Returns: Json }
      get_correcciones_de_caja: {
        Args: { p_movimientos: number[] }
        Returns: Json
      }
      get_corte_eventos: {
        Args: { p_corte_id: number }
        Returns: {
          accion: string
          created_at: string
          estado_antes: string
          estado_despues: string
          id: number
          motivo: string
          nombre: string
          nota: string
          photo_url: string
        }[]
      }
      get_corte_turno: {
        Args: { p_corte_id: number }
        Returns: {
          del_turno: boolean
          id: string
          name: string
          photo_url: string
          ventas: number
        }[]
      }
      get_corte_z_dias: {
        Args: { p_branch_id: number; p_periodo: string }
        Returns: {
          documentos: number
          fecha: string
          numero_control_al: string
          numero_control_del: string
          total: number
        }[]
      }
      get_cortes_diferencias: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          abonos: Json
          anulada_at: string
          anulada_motivo: string
          asentado_at: string
          asentado_nombre: string
          asentado_por: string
          asentado_ref: string
          branch_id: number
          causa: string
          corte_id: number
          evidencia_foto_url: string
          evidencia_ref: string
          fecha: string
          hora: string
          id: number
          impreso_at: string
          monto: number
          personas: Json
          registrado_at: string
          registrado_nombre: string
          registrado_por: string
          via: string
        }[]
      }
      get_cortes_por_embolsar: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          caja: string
          corte_id: number
          fecha: string
          hora: string
          sugerida: number
          total_declarado: number
        }[]
      }
      get_cortes_resolutores: {
        Args: { p_ids: string[] }
        Returns: {
          id: string
          name: string
          photo_url: string
        }[]
      }
      get_cortes_z: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          ccf_total: number
          comprobaciones: Json
          declaracion: Json
          departamento: string
          detalle: Json
          dif_ccf: number
          dif_factura: number
          dif_retencion: number
          dif_total: number
          direccion: string
          factura_total: number
          fecha_fin: string
          fecha_inicio: string
          hallazgos: Json
          obtenido_at: string
          periodo: string
          portal_ccf: number
          portal_documentos: number
          portal_factura: number
          portal_retencion: number
          portal_total: number
          residuo: number
          retencion: number
          sucursal: string
          ticket: string
          tiquete_total: number
          total_general: number
          z_ccf: number
          z_factura: number
          z_total: number
        }[]
      }
      get_cuentas_por_pagar: {
        Args: { p_desde?: string }
        Returns: {
          aplicado: number
          deuda: number
          dias_credito: number
          disponible: number
          documentos: number
          documentos_vencidos: number
          emisor_nit: string
          en_tramite: number
          forma_pago: string
          limite_credito: number
          proveedor: string
          proveedor_id: number
          proximo_vence: string
          saldo: number
          vencido: number
        }[]
      }
      get_cuentas_por_pagar_detalle: {
        Args: { p_emisor_nit: string }
        Returns: {
          aplicado: number
          codigo_generacion: string
          dias_vencido: number
          document_id: number
          en_tramite: number
          fecha_emision: string
          monto: number
          numero_control: string
          saldo: number
          tipo_dte: string
          vence: string
        }[]
      }
      get_customer_detail: { Args: { p_id: number }; Returns: Json }
      get_customers_page: {
        Args: {
          p_actividad?: string
          p_categoria?: string
          p_departamento?: string
          p_dir?: string
          p_erp?: string
          p_ficha?: string
          p_limit?: number
          p_mostrador?: string
          p_municipio?: string
          p_offset?: number
          p_revisar?: string
          p_search?: string
          p_sort?: string
        }
        Returns: Json
      }
      get_customers_stats: { Args: never; Returns: Json }
      get_depositos: {
        Args: { p_desde: string; p_hasta: string }
        Returns: Json
      }
      get_dias_con_diferencia: {
        Args: { p_desde: string; p_hasta: string }
        Returns: Json
      }
      get_dispensacion_por_folio: {
        Args: {
          p_anio: number
          p_branch_id: number
          p_clase?: string
          p_folio: number
        }
        Returns: Json
      }
      get_docs_sin_numero_control: {
        Args: { p_limit?: number }
        Returns: {
          codigo_generacion: string
          id: number
        }[]
      }
      get_documentos_por_barrer: {
        Args: { p_dias?: number; p_limite?: number }
        Returns: {
          document_id: number
          emisor_nit: string
          fecha_emision: string
          json_path: string
          restantes: number
        }[]
      }
      get_documentos_sin_cargar: {
        Args: { p_dias?: number }
        Returns: {
          codigo_generacion: string
          dias_desde: number
          document_id: number
          emisor_nit: string
          emisor_nombre: string
          fecha_emision: string
          monto_total: number
          numero_control: string
          proveedor_ficha: string
          renglones: number
          tiene_pdf: boolean
        }[]
      }
      get_donde_hay: {
        Args: { p_erp_product_id: number; p_erp_sucursal_destino: number }
        Returns: Json
      }
      get_draft_cost_estimate: {
        Args: { p_erp_sucursal_id: number }
        Returns: Json
      }
      get_employee_credenciales: {
        Args: { p_ids: string[] }
        Returns: {
          code: string
          employee_id: string
          kiosk_pin: string
        }[]
      }
      get_employee_identidad: {
        Args: { p_ids: string[] }
        Returns: {
          afp_number: string
          alt_identity_document: string
          dui: string
          dui_fecha_expedicion: string
          dui_fecha_vencimiento: string
          dui_lugar_expedicion: string
          employee_id: string
          isss_number: string
        }[]
      }
      get_employee_salarios: {
        Args: { p_ids: string[] }
        Returns: {
          account_number: string
          bank_name: string
          base_salary: number
          employee_id: string
        }[]
      }
      get_entrega: { Args: { p_id: number }; Returns: Json }
      get_envios_historial: { Args: { p_limite?: number }; Returns: Json }
      get_envios_vivos: { Args: never; Returns: Json }
      get_estados_de_personas: { Args: { p_ids: string[] }; Returns: Json }
      get_excedentes: { Args: { p_estado?: string }; Returns: Json }
      get_facturas_sala: {
        Args: {
          p_branch_id: number
          p_dias?: number
          p_incluir_tomadas?: boolean
        }
        Returns: {
          claim_id: number
          codigo_generacion: string
          document_id: number
          emisor_nombre: string
          estado: string
          etiqueta: string
          fecha_emision: string
          items_text: string
          json_path: string
          linea: string
          monto_total: number
          numero_control: string
          pdf_path: string
          registrada: boolean
          tomada_at: string
          tomada_por: string
          tomada_sala: string
        }[]
      }
      get_facturas_sala_panel: {
        Args: { p_dias?: number }
        Returns: {
          claim_id: number
          dias_sin_cargar: number
          document_id: number
          emisor_nombre: string
          etiqueta: string
          fecha_emision: string
          items_text: string
          liberada_at: string
          liberada_motivo: string
          monto_total: number
          origen: string
          registrada: boolean
          sala: string
          tomada_at: string
          tomada_por: string
        }[]
      }
      get_faltantes_con_stock_en_otra_sala: {
        Args: { p_erp_sucursal_id: number; p_limite?: number }
        Returns: {
          descripcion: string
          donde: Json
          erp_product_id: number
          min_units: number
        }[]
      }
      get_faltantes_de_bolsa: { Args: never; Returns: Json }
      get_inventory_cost_summary: {
        Args: { p_erp_sucursal_id?: number }
        Returns: Json
      }
      get_inventory_cost_summary_base: {
        Args: { p_erp_sucursal_id: number }
        Returns: Json
      }
      get_invoice_observations: {
        Args: {
          p_branch_id?: number
          p_desde: string
          p_dias_gracia_sello?: number
          p_hasta: string
        }
        Returns: {
          branch_id: number
          cliente: string
          correlativo: string
          erp_invoice_id: string
          estado: string
          fecha: string
          id: number
          motivos_mh: string[]
          observaciones: string[]
          recibido_mh: string
          tipo_documento: string
          total: number
        }[]
      }
      get_inyecciones_aplicadas: {
        Args: { p_branch_id: number; p_desde: string; p_hasta: string }
        Returns: Json
      }
      get_kiosk_auth_code: { Args: { p_branch_id?: number }; Returns: Json }
      get_kiosk_boot_payload: {
        Args: {
          p_device_id: string
          p_device_token: string
          p_week_start: string
        }
        Returns: Json
      }
      get_kiosk_coverage_employees: {
        Args: {
          p_device_id: string
          p_device_token: string
          p_week_start: string
        }
        Returns: Json
      }
      get_laboratorios_con_productos: { Args: never; Returns: Json }
      get_last_sale_dates: {
        Args: { p_erp_sucursal_id: number }
        Returns: {
          erp_product_id: number
          last_sale_date: string
        }[]
      }
      get_libro_anulados: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          cliente: string
          codigo_generacion: string
          correlativo: string
          erp_invoice_id: string
          fecha: string
          numero_control: string
          sello_recepcion: string
          tipo_documento: string
          total: number
        }[]
      }
      get_libro_compras: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          anulada: boolean
          branch_id: number
          compras_exentas: number
          compras_gravadas: number
          credito_fiscal: number
          documento_numero: string
          documento_tipo: string
          fecha: string
          nit: string
          nrc: string
          numero_control: string
          percepcion_iva: number
          proveedor: string
          retencion_iva: number
          total: number
        }[]
      }
      get_libro_compras_completo: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          anulada: boolean
          branch_id: number
          compras_exentas: number
          compras_gravadas: number
          credito_fiscal: number
          documento_completo: string
          documento_numero: string
          documento_tipo: string
          dte_id: number
          fecha: string
          json_path: string
          nit: string
          nrc: string
          numero_control: string
          origen: string
          pdf_path: string
          percepcion_iva: number
          proveedor: string
          retencion_iva: number
          tiene_dte: boolean
          tipo_dte: string
          total: number
        }[]
      }
      get_libro_compras_declarable: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          clasificacion: string
          compras_gravadas: number
          computa_credito: boolean
          credito_fiscal: number
          documento_completo: string
          documento_numero: string
          documento_tipo: string
          dte_id: number
          fecha: string
          json_path: string
          motivo: string
          nit: string
          nrc: string
          numero_control: string
          origen: string
          pdf_path: string
          percepcion_iva: number
          proveedor: string
          retencion_iva: number
          tipo_dte: string
          total: number
          veces_en_el_libro: number
        }[]
      }
      get_libro_percepcion: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          anulada: boolean
          branch_id: number
          documento_numero: string
          documento_tipo: string
          fecha: string
          monto_sujeto: number
          nit: string
          nrc: string
          percepcion_iva: number
          proveedor: string
        }[]
      }
      get_libro_retencion: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          anulada: boolean
          branch_id: number
          documento_numero: string
          documento_tipo: string
          fecha: string
          monto_sujeto: number
          nit: string
          nrc: string
          proveedor: string
          retencion_iva: number
        }[]
      }
      get_libro_sujeto_excluido: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          documento_numero: string
          dui: string
          fecha: string
          nit: string
          proveedor: string
          total: number
        }[]
      }
      get_libro_ventas_consumidor: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          codigo_gen_al: string
          codigo_gen_del: string
          correlativo_al: string
          correlativo_del: string
          documentos: number
          erp_id_al: string
          erp_id_del: string
          exportaciones: number
          fecha: string
          numero_control_al: string
          numero_control_del: string
          sello_del: string
          total_diario: number
          ventas_exentas: number
          ventas_gravadas: number
        }[]
      }
      get_libro_ventas_contribuyente: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          cliente: string
          codigo_generacion: string
          correlativo: string
          debito_fiscal: number
          dui: string
          erp_invoice_id: string
          fecha: string
          nit: string
          nrc: string
          numero_control: string
          retencion_iva: number
          sello_recepcion: string
          total: number
          ventas_exentas: number
          ventas_gravadas: number
        }[]
      }
      get_lockable_modules: {
        Args: never
        Returns: {
          module_key: string
          veces: number
        }[]
      }
      get_logistics_chief_ids: { Args: never; Returns: string[] }
      get_meta_sala: {
        Args: { p_branch_id?: number }
        Returns: {
          bonificaciones_activas: boolean
          bono_tier: string
          branch_id: number
          dias_mes: number
          dias_restantes: number
          dias_transcurridos: number
          estado: string
          falta: number
          monto_meta: number
          pct_cumplimiento: number
          pct_proyectado: number
          proyeccion: number
          ritmo_necesario: number
          sala: string
          umbral_medio: number
          umbral_total: number
          venta_acumulada: number
          venta_hoy: number
          year_month: string
        }[]
      }
      get_metas_autorizadores: {
        Args: never
        Returns: {
          id: string
          name: string
        }[]
      }
      get_metas_dashboard: {
        Args: { p_year_month: string }
        Returns: {
          bono_tier: string
          branch_id: number
          dias_mes: number
          dias_transcurridos: number
          estado: string
          monto_meta: number
          nota: string
          pct_cumplimiento: number
          pct_proyectado: number
          proyeccion: number
          venta_acumulada: number
        }[]
      }
      get_metas_gastos: { Args: never; Returns: Json }
      get_metas_historico: {
        Args: never
        Returns: {
          bono_tier: string
          branch_id: number
          monto_meta: number
          nota: string
          pct_cumplimiento: number
          venta_total: number
          year_month: string
        }[]
      }
      get_metas_mes_en_curso: { Args: { p_branch_id?: number }; Returns: Json }
      get_minmax_approver_ids: { Args: never; Returns: string[] }
      get_minmax_contexto_producto: {
        Args: { p_erp_product_id: number; p_erp_sucursal_id: number }
        Returns: Json
      }
      get_minmax_solicitudes_de_producto: {
        Args: { p_erp_product_id: number; p_erp_sucursal_id: number }
        Returns: Json
      }
      get_no_sales_products: {
        Args: { p_erp_sucursal_id: number }
        Returns: {
          cost_value: number
          current_stock: number
          erp_product_id: number
          fecha_vencimiento_min: string
          max_qty: number
          min_qty: number
          product_name: string
          sold_in: Json
        }[]
      }
      get_notas_credito_compras: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          codigo_generacion: string
          compra_branch_id: number
          compra_documento: string
          compra_fecha: string
          compra_id: number
          compra_total: number
          documento_corregido: string
          fecha: string
          iva: number
          monto: number
          nit: string
          nrc: string
          numero_control: string
          proveedor: string
          tipo_dte: string
          vinculo: string
        }[]
      }
      get_operacion_de_bolsa: {
        Args: { p_operacion_id: number }
        Returns: Json
      }
      get_pagos_bono_producto: { Args: never; Returns: Json }
      get_pagos_compra: {
        Args: { p_dias?: number; p_emisor_nit?: string }
        Returns: {
          anulado_motivo: string
          aprobado_at: string
          aprobado_por: string
          emisor_nit: string
          estado: string
          facturas: number
          fecha: string
          forma: string
          id: number
          monto: number
          nota: string
          proveedor: string
          referencia: string
          registrado_at: string
          registrado_por: string
        }[]
      }
      get_pausa_razones_stats: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          conteo: number
          min_promedio: number
          razon: string
        }[]
      }
      get_pedido_diferencias_stats: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: Json
      }
      get_pedido_entregas: {
        Args: { p_pedido_ids: string[] }
        Returns: {
          conductor_id: string
          conductor_nombre: string
          entregado_at: string
          entregado_por: string
          erp_sucursal_id: number
          pedido_id: string
        }[]
      }
      get_pedido_generar_dashboard: {
        Args: { p_sucursal_ids?: number[] }
        Returns: Json
      }
      get_pedido_item_stats: {
        Args: { p_pedido_ids: string[] }
        Returns: {
          agotamiento: number
          con_diferencia: number
          enviados: number
          erp_sucursal_id: number
          no_enviados: number
          pedido_id: string
          pendientes: number
          por_regla: number
          sin_resolver: number
          sin_stock: number
        }[]
      }
      get_pedido_kpis: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: {
          created_at: string
          erp_sucursal_id: number
          num_pausas: number
          numero: number
          pedido_id: string
          tiempo_pausado_min: number
          tiempo_prep_neto_min: number
          tiempo_recuento_min: number
          tiempo_transito_min: number
        }[]
      }
      get_pedido_preview: {
        Args: { p_sucursal_ids: number[]; p_target_ids?: number[] }
        Returns: Json
      }
      get_pedido_sin_bodega: {
        Args: { p_sucursal_ids?: number[] }
        Returns: Json
      }
      get_pedido_sucursal_stats: {
        Args: { p_sucursal_ids?: number[] }
        Returns: {
          avg_urgencia_pct: number
          con_bodega_packs: number
          con_bodega_productos: number
          erp_sucursal_id: number
          last_pedido_at: string
          necesidad_packs: number
          sin_bodega_packs: number
          sin_bodega_productos: number
          total_productos: number
        }[]
      }
      get_pedidos_en_curso: {
        Args: never
        Returns: {
          caja_map: Json
          cajas_danadas: Json
          cajas_electrolit: number
          cajas_especiales: Json
          cajas_especiales_llegadas: Json
          codigo: string
          confirmado_correccion_at: string
          confirmado_correccion_por: string
          corregido_bodega_at: string
          corregido_bodega_nota: string
          corregido_bodega_por: string
          created_at: string
          created_by: string
          diferencias_reportadas_at: string
          diferencias_reportadas_por: string
          electrolit_faltantes: number
          electrolit_ok: boolean
          entrega_programada_at: string
          entrega_programada_historial: Json
          enviado_at: string
          enviado_por: string
          erp_sucursal_id: number
          falta_caja_at: string
          falta_cajas: Json
          finalizado_at: string
          finalizado_por: string
          iniciado_at: string
          iniciado_por: string
          llegada_fisica_at: string
          llegada_fisica_por: string
          llegada_nota: string
          llegada_tipo: string
          min_pausado_total: number
          notes: string
          numero: number
          pausado_at: string
          pauses: Json
          pedido_id: string
          pedido_status: string
          reanudado_at: string
          reanudado_por: string
          recibido_erp_at: string
          recibido_erp_por: string
          reenvio_bodega_at: string
          reenvio_por: string
          reenvios_historial: Json
          segunda_llegada_at: string
          status: string
          total_cajas: number
        }[]
      }
      get_pending_mh_invoices: { Args: { p_branch_id?: number }; Returns: Json }
      get_periodo_fiscal: { Args: { p_periodo: string }; Returns: Json }
      get_periodos_fiscales: { Args: never; Returns: Json }
      get_personas_de_administracion: { Args: never; Returns: Json }
      get_personas_de_solicitudes: {
        Args: { p_claves: string[]; p_ids: string[] }
        Returns: {
          branch_id: number
          clave: string
          first_names: string
          id: string
          last_names: string
          name: string
          photo_url: string
          role_id: number
        }[]
      }
      get_por_depositar: { Args: never; Returns: Json }
      get_precio_tipo: {
        Args: {
          p_fecha?: string
          p_id_presentacion: number
          p_precio_unitario: number
          p_product_id: number
        }
        Returns: string
      }
      get_precios_con_costo: {
        Args: { p_product_ids?: number[]; p_solo_activos?: boolean }
        Returns: Json
      }
      get_precios_para_descuento: { Args: { p_ids: number[] }; Returns: Json }
      get_presentaciones_de_producto: {
        Args: { p_erp_product_id: number }
        Returns: Json
      }
      get_presentaciones_maestro: { Args: never; Returns: Json }
      get_product_branch_summary: {
        Args: { p_erp_product_id: number }
        Returns: {
          alert_status: string
          current_stock: number
          draft_max: number
          draft_min: number
          draft_status: string
          effective_max: number
          effective_min: number
          erp_sucursal_id: number
          vencidos_stock: number
        }[]
      }
      get_product_drill_lines: {
        Args: {
          p_branch_id?: number
          p_erp_product_id: number
          p_ffin: string
          p_fini: string
        }
        Returns: {
          branch_id: number
          cantidad: number
          cliente: string
          cod_vendedor: string
          correlativo: string
          erp_invoice_id: string
          fecha: string
          fecha_vencimiento: string
          id_presentacion: number
          invoice_id: number
          item_id: number
          lote: string
          neto: number
          precio_unitario: number
          presentacion: string
          tipo_documento: string
          tipo_pago: string
        }[]
      }
      get_product_drill_summary: {
        Args: {
          p_branch_id?: number
          p_erp_product_id: number
          p_ffin: string
          p_fini: string
        }
        Returns: Json
      }
      get_product_expiring_lots: {
        Args: { p_days_ahead?: number; p_erp_product_id: number }
        Returns: {
          cantidad: number
          days_remaining: number
          erp_sucursal_id: number
          fecha_vencimiento: string
          lote: string
          presentacion: string
        }[]
      }
      get_product_last_sales: {
        Args: { p_erp_product_id: number; p_erp_sucursal_id?: number }
        Returns: {
          cantidad: number
          cliente: string
          erp_sucursal_id: number
          fecha: string
          total_linea: number
        }[]
      }
      get_product_sales_agg: {
        Args: {
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_search?: string
        }
        Returns: {
          cantidad: number
          costo_total: number
          descripcion: string
          erp_product_id: number
          laboratorio_id: number
          laboratorio_nombre: string
          neto: number
          oculto_at: string
          oculto_en_ventas: boolean
          oculto_por_first_names: string
          oculto_por_last_names: string
          presentaciones: Json
          ultima_venta: string
          ultima_venta_por_suc: Json
        }[]
      }
      get_product_sales_agg_base: {
        Args: {
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_search?: string
        }
        Returns: {
          cantidad: number
          costo_total: number
          descripcion: string
          erp_product_id: number
          laboratorio_id: number
          laboratorio_nombre: string
          neto: number
          oculto_at: string
          oculto_en_ventas: boolean
          oculto_por_first_names: string
          oculto_por_last_names: string
          presentaciones: Json
          ultima_venta: string
          ultima_venta_por_suc: Json
        }[]
      }
      get_product_sales_agg_jsonb: {
        Args: {
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_search?: string
        }
        Returns: Json
      }
      get_product_sales_total: {
        Args: { p_branch_id?: number; p_ffin: string; p_fini: string }
        Returns: number
      }
      get_product_trend: {
        Args: {
          p_branch_id?: number
          p_erp_product_id: number
          p_ffin?: string
          p_fini?: string
        }
        Returns: {
          cantidad: number
          month: string
          neto: number
        }[]
      }
      get_product_vencimiento_policy: {
        Args: { p_erp_product_id: number }
        Returns: {
          es_cofarsal: boolean
          es_devolutivo: boolean
          meses_devolucion: number
          proveedor_id: number
          proveedor_nombre: string
          resolucion: string
        }[]
      }
      get_productos_para_promocion: {
        Args: { p_laboratorio_id?: number; p_limit?: number; p_search?: string }
        Returns: Json
      }
      get_productos_por_confirmar: {
        Args: { p_estado: string; p_limite: number }
        Returns: {
          codigo_proveedor: string
          descripcion: string
          documentos: number
          emisor_nit: string
          id: number
          ignorado: boolean
          llave: string
          proveedor: string
          renglones: number
          resuelto: boolean
          sugerido_nombre: string
          sugerido_origen: string
          sugerido_product_id: number
          sugerido_similitud: number
          ultima_fecha: string
          unidades: number
        }[]
      }
      get_productos_por_presentacion: {
        Args: { p_tipo: string }
        Returns: Json
      }
      get_products_sold_no_minmax: {
        Args: { p_erp_sucursal_id?: number }
        Returns: {
          erp_product_id: number
          invoice_count: number
          laboratorio: string
          months_with_sales: number
          product_name: string
          revenue: number
          units_sold: number
        }[]
      }
      get_products_sold_no_minmax_jsonb: {
        Args: { p_erp_sucursal_id: number }
        Returns: Json
      }
      get_promocion: { Args: { p_id: number }; Returns: Json }
      get_promocion_laboratorio: {
        Args: { p_id: number; p_year_month?: string }
        Returns: Json
      }
      get_promociones: {
        Args: { p_estado?: string; p_tipo?: string }
        Returns: Json
      }
      get_proveedores_maestro: { Args: never; Returns: Json }
      get_puntos_canjeados: {
        Args: {
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_hora_corte?: string
        }
        Returns: number
      }
      get_purchase_dte_documents: {
        Args: { p_desde?: string; p_hasta?: string }
        Returns: Json
      }
      get_purchase_dte_review_queue: {
        Args: { p_status?: string }
        Returns: Json
      }
      get_purchase_dte_review_source: {
        Args: { p_document_id: number }
        Returns: Json
      }
      get_quiebres_sala: {
        Args: { p_dias?: number; p_erp_sucursal_id: number }
        Returns: Json
      }
      get_recetas_abiertas: { Args: { p_branch_id: number }; Returns: Json }
      get_recetas_recientes: {
        Args: { p_branch_id: number; p_dias?: number }
        Returns: Json
      }
      get_remitentes_dte_conocidos: {
        Args: { p_account_id?: number }
        Returns: Json
      }
      get_resumen_fiscal: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: Json
      }
      get_retencion_ventas: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          anulada: boolean
          branch_id: number
          cliente: string
          codigo_generacion: string
          correlativo: string
          erp_invoice_id: string
          fecha: string
          json_path: string
          monto_sujeto: number
          nit: string
          nrc: string
          numero_control: string
          pdf_path: string
          retencion_iva: number
          sello_recepcion: string
          tipo_documento: string
          total: number
        }[]
      }
      get_salidas_de_bolsa: {
        Args: { p_bolsa_id: number }
        Returns: {
          anulado_at: string
          entidad: string
          etiqueta: string
          etiqueta_entidad: string
          foto_url: string
          impreso_at: string
          leyenda: string
          monto: number
          monto_operacion: number
          movimiento_id: number
          nota: string
          numero_boleta: string
          operacion_folio: string
          operacion_id: number
          recibido_metodo: string
          recibido_nombre: string
          registrado_at: string
          registrado_nombre: string
          tipo: string
          vale_folio: string
        }[]
      }
      get_stagnant_inventory: {
        Args: { p_erp_sucursal_id?: number }
        Returns: {
          cost_value: number
          current_stock: number
          erp_product_id: number
          fecha_vencimiento_min: string
          in_minmax: boolean
          laboratorio: string
          max_qty: number
          min_qty: number
          product_name: string
          sold_in: Json
          ultima_venta: string
        }[]
      }
      get_stagnant_inventory_base: {
        Args: { p_erp_sucursal_id?: number }
        Returns: {
          cost_value: number
          current_stock: number
          erp_product_id: number
          fecha_vencimiento_min: string
          in_minmax: boolean
          laboratorio: string
          max_qty: number
          min_qty: number
          product_name: string
          sold_in: Json
          ultima_venta: string
        }[]
      }
      get_stagnant_inventory_jsonb: {
        Args: { p_erp_sucursal_id: number }
        Returns: Json
      }
      get_stock_analysis: {
        Args: { p_erp_sucursal_id: number }
        Returns: {
          abc_class: string
          alert_status: string
          calc_max: number
          calc_min: number
          calculated_at: string
          current_stock: number
          cv: number
          daily_velocity: number
          demand_variability: string
          dispatch_multiplo: number
          dispatch_pres_factor: number
          dispatch_tipo: string
          draft_abc_class: string
          draft_calculated_at: string
          draft_demand_variability: string
          draft_max: number
          draft_min: number
          draft_status: string
          effective_max: number
          effective_min: number
          erp_product_id: number
          foto_url: string
          has_manual: boolean
          has_pending_branches: boolean
          is_catalog_only: boolean
          is_dead_stock: boolean
          is_hidden: boolean
          laboratorio_nombre: string
          last_sale_date: string
          last_sale_sucursal_id: number
          presentations: Json
          product_name: string
          pub_max: number
          pub_min: number
          published_by: string
          revenue_6m: number
          units_sold_6m: number
          velocity_30d: number
        }[]
      }
      get_stock_analysis_jsonb: {
        Args: { p_erp_sucursal_id: number }
        Returns: Json
      }
      get_sucursal_net_stock: {
        Args: { p_product_ids: number[] }
        Returns: {
          erp_product_id: number
          net_stock: number
        }[]
      }
      get_top_productos_mes: {
        Args: { p_ffin: string; p_fini: string; p_limite?: number }
        Returns: {
          descripcion: string
          erp_product_id: number
          neto: number
        }[]
      }
      get_top_supplier_per_product: {
        Args: { p_product_ids: number[] }
        Returns: {
          erp_product_id: number
          proveedor: string
        }[]
      }
      get_traslado_disponibilidad: {
        Args: { p_request_id: string }
        Returns: Json
      }
      get_traslados_por_recibir: {
        Args: { p_branch_id?: string }
        Returns: Json
      }
      get_vendedor_diario:
        | {
            Args: {
              p_branch_id: number
              p_cod_vendedor: string
              p_ffin: string
              p_fini: string
            }
            Returns: {
              fecha: string
              total_facturas: number
              total_ventas: number
            }[]
          }
        | {
            Args: { p_cod_vendedor: string; p_ffin: string; p_fini: string }
            Returns: {
              branch_id: number
              fecha: string
              total_facturas: number
              total_ventas: number
            }[]
          }
      get_vendedores: {
        Args: never
        Returns: {
          branch_id: number
          code: string
          first_names: string
          id: string
          last_names: string
          name: string
          photo_url: string
        }[]
      }
      get_vendedores_resumen: {
        Args: { p_branch_id?: number; p_ffin: string; p_fini: string }
        Returns: {
          branch_id: number
          cod_vendedor: string
          total_facturas: number
          total_ventas: number
        }[]
      }
      get_ventas_con_puntos: {
        Args: {
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_limit?: number
          p_offset?: number
          p_sort_col?: string
          p_sort_dir?: string
        }
        Returns: {
          branch_id: number
          cliente: string
          cod_vendedor: string
          correlativo: string
          erp_invoice_id: string
          estado: string
          fecha: string
          hora: string
          id: number
          iva: number
          n: number
          subtotal: number
          tipo_documento: string
          tipo_pago: string
          total: number
        }[]
      }
      get_ventas_con_receta: {
        Args: {
          p_anuladas?: string
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_solo_receta?: boolean
          p_sort_col?: string
          p_sort_dir?: string
        }
        Returns: {
          branch_id: number
          cliente: string
          cod_vendedor: string
          correlativo: string
          erp_invoice_id: string
          estado: string
          fecha: string
          has_puntos: boolean
          hora: string
          id: number
          iva: number
          recibido_mh: string
          retencion: number
          subtotal: number
          tipo_documento: string
          tipo_pago: string
          total: number
        }[]
      }
      get_ventas_fuera_del_libro: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: {
          documentos: number
          monto: number
          sello_invalido: number
          sin_sello: number
        }[]
      }
      get_ventas_por_forma_de_pago: {
        Args: { p_desde: string; p_hasta: string }
        Returns: {
          branch_id: number
          documentos: number
          fecha: string
          tipo_pago: string
          total: number
        }[]
      }
      get_ventas_receta_stats: {
        Args: {
          p_anuladas?: string
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_search?: string
          p_solo_receta?: boolean
        }
        Returns: {
          total_count: number
          total_count_todas: number
          total_puntos: number
          total_sum: number
        }[]
      }
      get_ventas_sin_producto: {
        Args: { p_branch_id?: number; p_ffin: string; p_fini: string }
        Returns: Json
      }
      get_ventas_stats: {
        Args: {
          p_branch_id?: number
          p_ffin: string
          p_fini: string
          p_hora_corte?: string
        }
        Returns: {
          total_count: number
          total_count_todas: number
          total_sum: number
        }[]
      }
      guardar_conteo_item: {
        Args: {
          p_estado_item?: string
          p_fisico_cantidad: number
          p_item_id: string
          p_nota?: string
        }
        Returns: Json
      }
      guardar_datos_protegidos_de_empleado: {
        Args: { p_id: string; p_patch: Json }
        Returns: undefined
      }
      guardar_dia_de_horario: {
        Args: {
          p_datos: Json
          p_dia: string
          p_employee_id: string
          p_week_start: string
        }
        Returns: Json
      }
      guardar_foto_de_captura: {
        Args: { p_secreto: string; p_url: string }
        Returns: Json
      }
      guardar_lectura_de_boleta: {
        Args: { p_lectura: Json; p_operacion_id: number }
        Returns: undefined
      }
      guardar_minmax_desde_pedido: {
        Args: { p_max: number; p_min: number; p_pedido_item_id: number }
        Returns: Json
      }
      hay_alguien_no_disponible: { Args: never; Returns: boolean }
      hereda_por_ausencia_emp: {
        Args: { p_action: string; p_employee_id: string; p_module_key: string }
        Returns: boolean
      }
      hereda_por_ausencia_rol: {
        Args: { p_action: string; p_module_key: string; p_role_id: number }
        Returns: boolean
      }
      hora_12: { Args: { p_hora: string }; Returns: string }
      hora_del_horario: { Args: { p_texto: string }; Returns: string }
      horarios_de_la_semana: {
        Args: { p_branch_id: number; p_week_start: string }
        Returns: Json
      }
      identificar_por_carne: {
        Args: { p_valor: string }
        Returns: {
          first_names: string
          id: string
          last_names: string
          name: string
          photo_url: string
        }[]
      }
      ignorar_renglon_pendiente: {
        Args: { p_deshacer?: boolean; p_id: number; p_motivo: string }
        Returns: undefined
      }
      incrementar_reanudacion_traslado: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      init_pedido_sucursal_codigos: {
        Args: { p_codigos: Json; p_pedido_id: string }
        Returns: undefined
      }
      insert_missing_products: { Args: { p_rows: Json }; Returns: number }
      inventory_daily_mantener_particiones: { Args: never; Returns: Json }
      inventory_daily_snapshot: { Args: { p_fecha?: string }; Returns: Json }
      inventory_grouped: {
        Args: {
          p_area_vencidos?: boolean
          p_categoria?: string
          p_erp_id?: number
          p_lab_id?: number
          p_limit?: number
          p_offset?: number
          p_proximos?: boolean
          p_search?: string
          p_sort?: string
          p_sort_dir?: string
          p_vencidos?: boolean
        }
        Returns: {
          descripcion: string
          earliest_venc: string
          erp_product_id: number
          erp_sucursal_id: number
          es_antibiotico: boolean
          laboratorio: string
          lote_sample: string
          num_lotes: number
          presentaciones: string[]
          total: number
          total_unidades: number
        }[]
      }
      inventory_inversion: {
        Args: {
          p_categoria?: string
          p_erp_id?: number
          p_lab_id?: number
          p_search?: string
        }
        Returns: number
      }
      inventory_proximos_count: {
        Args: {
          p_categoria?: string
          p_erp_id?: number
          p_lab_id?: number
          p_search?: string
        }
        Returns: number
      }
      items_sin_ingresar: {
        Args: { p_pedido_id: string; p_sucursal_id: number }
        Returns: number[]
      }
      jsonb_es_verdadero: { Args: { v: Json }; Returns: boolean }
      justificar_diferencia_corte: {
        Args: {
          p_causa?: string
          p_evidencia_foto?: string
          p_evidencia_ref?: string
          p_id: number
          p_motivo: string
        }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          causa: string
          corte_id: number
          created_at: string
          evidencia_foto_url: string | null
          evidencia_ref: string | null
          fecha: string
          id: number
          impreso_at: string | null
          monto: number
          registrado_at: string
          registrado_por: string | null
          updated_at: string
          via: string
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja_diferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      kiosco_aviso_leido: {
        Args: {
          p_announcement_id: string
          p_device_id: string
          p_device_token: string
          p_employee_id: string
        }
        Returns: Json
      }
      kiosco_bitacora: {
        Args: {
          p_accion: string
          p_detalles?: Json
          p_device_id: string
          p_device_token: string
          p_employee_id?: string
        }
        Returns: Json
      }
      kiosco_cubre_empleado: {
        Args: { p_branch_id: number; p_employee_id: string }
        Returns: boolean
      }
      kiosco_declarar_turno: {
        Args: {
          p_device_id: string
          p_device_token: string
          p_employee_id: string
          p_fin: string
          p_inicio: string
          p_metadata?: Json
        }
        Returns: Json
      }
      kiosco_identificar: {
        Args: { p_carne: string; p_device_id: string; p_device_token: string }
        Returns: Json
      }
      kiosco_marcajes_recientes: {
        Args: { p_device_id: string; p_device_token: string }
        Returns: Json
      }
      kiosco_marcar: {
        Args: {
          p_detalles?: Json
          p_device_id: string
          p_device_token: string
          p_employee_id: string
          p_momento?: string
          p_tipo: string
        }
        Returns: Json
      }
      kiosco_sucursal: {
        Args: { p_device_id: string; p_device_token: string }
        Returns: number
      }
      kiosk_auth_code_for: {
        Args: { p_branch_id: number; p_bucket: string; p_su: boolean }
        Returns: string
      }
      liberar_solicitud: { Args: { p_request_id: string }; Returns: undefined }
      ligar_abono_a_ingreso: {
        Args: { p_abono_id: number; p_movimiento_id: number }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          created_at: string
          diferencia_id: number
          employee_id: string
          id: number
          impreso_at: string | null
          monto: number
          movimiento_id: number | null
          persona_id: number
          registrado_at: string
          registrado_por: string | null
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja_diferencia_abonos"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ligar_notas_a_compras: { Args: never; Returns: Json }
      linea_telefonica_de: { Args: { p_texto: string }; Returns: string }
      list_sessions: { Args: never; Returns: Json }
      lock_module: {
        Args: { p_hours?: number; p_module_key: string; p_reason?: string }
        Returns: Json
      }
      marcar_abonos_impresos: { Args: { p_ids: number[] }; Returns: number }
      marcar_ajuste_erp: {
        Args: { p_conteo_id: string; p_nota?: string }
        Returns: Json
      }
      marcar_aviso_leido: { Args: { p_announcement_id: string }; Returns: Json }
      marcar_comprobante_impreso: {
        Args: { p_id: number }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          causa: string
          corte_id: number
          created_at: string
          evidencia_foto_url: string | null
          evidencia_ref: string | null
          fecha: string
          id: number
          impreso_at: string | null
          monto: number
          registrado_at: string
          registrado_por: string | null
          updated_at: string
          via: string
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja_diferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      marcar_conteo_bolsa: {
        Args: { p_contado: number; p_esperado: number; p_id: number }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          caja: string | null
          cerrada_at: string
          cerrada_por: string | null
          contado: number | null
          contado_at: string | null
          contado_por: string | null
          conteo_id: number | null
          conteo_marcado: number | null
          conteo_marcado_at: string | null
          conteo_marcado_por: string | null
          corte_id: number | null
          created_at: string
          deposito_id: number | null
          dif_at: string | null
          dif_causa: string | null
          dif_foto_url: string | null
          dif_por: string | null
          dif_via: string | null
          entrega_id: number | null
          entregada_at: string | null
          entregada_por: string | null
          estado: string
          etiqueta_impresa_at: string | null
          etiqueta_version: number
          fecha: string
          folio: string
          hora: string
          id: number
          monto_inicial: number
          motivo_origen: string | null
          origen: string
          recibida_at: string | null
          recibida_por: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      marcar_empujado_al_erp: { Args: { p_ids: number[] }; Returns: Json }
      marcar_etiqueta_impresa: { Args: { p_bolsa_id: number }; Returns: number }
      marcar_pedido_enviado: {
        Args: { p_enviado_por?: string; p_pedido_id: string }
        Returns: undefined
      }
      marcar_solventado_internamente: {
        Args: { p_actor?: string; p_invoice_id: number }
        Returns: Json
      }
      marcar_vale_impreso: {
        Args: { p_movimiento_id: number }
        Returns: boolean
      }
      merge_purchase_dte_documents: {
        Args: { p_source_id: number; p_target_id: number }
        Returns: undefined
      }
      meses_del_semestre: { Args: { p_semestre: string }; Returns: string[] }
      meta_de_pedido: {
        Args: {
          p_cajas?: number
          p_conductor?: string
          p_conductor_id?: string
          p_detalle?: string
          p_etapa: string
          p_numeros: number[]
          p_sala: string
        }
        Returns: Json
      }
      metas_aplicar_recuperacion: {
        Args: { p_branch_id: number; p_year_month: string }
        Returns: undefined
      }
      metas_avisar_cierre_a_admin: {
        Args: { p_ultimo_intento?: boolean; p_ym_cerrado: string }
        Returns: number
      }
      metas_avisar_cierre_a_salas: {
        Args: { p_ultimo_intento?: boolean; p_ym_cerrado: string }
        Returns: number
      }
      metas_bono_activo: { Args: { p_year_month: string }; Returns: boolean }
      metas_calculo_propuesta: {
        Args: { p_year_month: string }
        Returns: {
          branch_id: number
          dias_mes: number
          factor: number
          meses: Json
          meta_ultimo: number
          pct_ultimo: number
          propuesta: number
          ritmo_dia: number
          sub_ritmo: number
          suma_dias: number
          suma_venta: number
          ultimo_proyectado: boolean
          ym_ultimo: string
        }[]
      }
      metas_ciclo_diario: { Args: never; Returns: string }
      metas_gasto_reparto: {
        Args: {
          p_margen: number
          p_meses: number
          p_salas: Json
          p_ym_inicio: string
        }
        Returns: {
          branch_id: number
          monto_gasto: number
          monto_venta: number
          year_month: string
        }[]
      }
      metas_log: {
        Args: {
          p_estado_antes?: string
          p_estado_despues?: string
          p_evento: string
          p_meta_id: number
          p_monto_antes?: number
          p_monto_despues?: number
          p_nota?: string
        }
        Returns: undefined
      }
      metas_mes_label: { Args: { p_ym: string }; Returns: string }
      metas_nota_propuesta: {
        Args: {
          p_factor: number
          p_pct: number
          p_proyectado: boolean
          p_ym_ultimo: string
        }
        Returns: string
      }
      metas_notificar_rol:
        | {
            Args: {
              p_body: string
              p_role_name: string
              p_title: string
              p_type: string
            }
            Returns: number
          }
        | {
            Args: {
              p_body: string
              p_metadata: Json
              p_role_name: string
              p_title: string
              p_type: string
            }
            Returns: number
          }
      metas_tramo_de_pct: { Args: { p_pct: number }; Returns: string }
      minmax_eff_max: {
        Args: {
          p_base_max: number
          p_base_min: number
          p_manual_max: number
          p_manual_min: number
        }
        Returns: number
      }
      minmax_eff_min: {
        Args: {
          p_base_max: number
          p_base_min: number
          p_manual_max: number
          p_manual_min: number
        }
        Returns: number
      }
      minmax_effective: {
        Args: { p_base: number; p_manual: number }
        Returns: number
      }
      mis_permisos_heredados: {
        Args: never
        Returns: {
          can_approve: boolean
          can_edit: boolean
          can_view: boolean
          module_key: string
          scope: string
        }[]
      }
      modulo_de_aprobacion: { Args: { p_type: string }; Returns: string }
      modulo_de_notificacion: { Args: { p_type: string }; Returns: string }
      motivo_de_solicitud: {
        Args: { p_metadata: Json; p_note: string }
        Returns: string
      }
      motivos_envio: { Args: never; Returns: string[] }
      motivos_envio_con_foto: { Args: never; Returns: string[] }
      motivos_envio_por_direccion: {
        Args: { p_destino_es_bodega: boolean; p_origen_es_bodega: boolean }
        Returns: string[]
      }
      motivos_rechazo_envio: { Args: never; Returns: string[] }
      next_cotizacion_numero: { Args: never; Returns: string }
      nit_sv_valido: { Args: { p_nit: string }; Returns: boolean }
      nombre_corto_de_empleado: {
        Args: { p_first: string; p_full?: string; p_last: string }
        Returns: string
      }
      nombre_de_pago: { Args: { p_valor: string }; Returns: string }
      nombre_de_vendedor: { Args: { p_codigo: string }; Returns: string }
      nombre_normalizado: { Args: { p_nombre: string }; Returns: string }
      norm_busqueda: { Args: { p: string }; Returns: string }
      norm_search: { Args: { "": string }; Returns: string }
      notificaciones_que_coinciden: {
        Args: { p_desde: string; p_q: string }
        Returns: Json
      }
      notificar_envio_despachado: {
        Args: { p_request_id: string }
        Returns: number
      }
      notify_branch: {
        Args: {
          p_body?: string
          p_branch_id: number
          p_link?: string
          p_metadata?: Json
          p_push?: boolean
          p_title: string
          p_type: string
        }
        Returns: number
      }
      notify_branch_como: {
        Args: {
          p_actor: string
          p_body?: string
          p_branch_id: number
          p_link?: string
          p_metadata?: Json
          p_push?: boolean
          p_title: string
          p_type: string
        }
        Returns: number
      }
      notify_employees: {
        Args: {
          p_body?: string
          p_branch_id?: number
          p_link?: string
          p_metadata?: Json
          p_push?: boolean
          p_recipients: string[]
          p_title: string
          p_type: string
        }
        Returns: number
      }
      notify_missing_roster: { Args: never; Returns: undefined }
      nuevo_folio_de_bolsa: { Args: { p_branch_id: number }; Returns: string }
      numeros_de_caja: { Args: { p: Json }; Returns: string }
      paso_de_monto: { Args: { p_monto: number }; Returns: number }
      pedir_dato_a_la_sala: {
        Args: {
          p_campo?: string
          p_customer_id: number
          p_motivo_mh?: string
          p_valor_actual?: string
        }
        Returns: Json
      }
      planificar_traslado_pedido: {
        Args: { p_pedido_id: string; p_run_id: string; p_sucursal_id: number }
        Returns: Json
      }
      preview_metas_gasto: {
        Args: { p_meses: number; p_salas: Json; p_ym_inicio: string }
        Returns: Json
      }
      preview_muestra_ciclica: {
        Args: { p_branch_id: number; p_tamano?: number }
        Returns: Json
      }
      probar_identidad: {
        Args: { p_employee_id: string; p_metodo: string; p_secreto: string }
        Returns: Json
      }
      probar_identidad_por_carne: { Args: { p_secreto: string }; Returns: Json }
      probar_identidad_por_usuario: {
        Args: { p_secreto: string; p_usuario: string }
        Returns: Json
      }
      productos_parados_de_sala: {
        Args: { p_erp_sucursal_id: number }
        Returns: Json
      }
      productos_por_codigo: { Args: { p_search: string }; Returns: number[] }
      promocion_avance: {
        Args: { p_solo_abiertos?: boolean }
        Returns: {
          branch_id: number
          renglon_id: number
          vendido: number
        }[]
      }
      promocion_corte_del_lote: {
        Args: { p_promocion_id?: number }
        Returns: {
          branch_id: number
          cod_vendedor: string
          employee_id: string
          fondo_adm: number
          fondo_bodega: number
          monto_dentro: number
          monto_excedente: number
          promocion_id: number
          renglon_id: number
          u_dentro: number
          u_excedente: number
        }[]
      }
      promocion_laboratorio_avance: {
        Args: { p_id: number; p_year_month: string }
        Returns: {
          branch_id: number
          costo: number
          falta: number
          monto_por_persona: number
          nivel: number
          personas: number
          sala: string
          siguiente_monto: number
          siguiente_nivel: number
          siguiente_umbral: number
          venta: number
        }[]
      }
      promocion_log: {
        Args: {
          p_branch_id?: number
          p_evento?: string
          p_nota?: string
          p_promocion_id: number
          p_renglon_id?: number
          p_valor_antes?: string
          p_valor_despues?: string
        }
        Returns: undefined
      }
      promocion_mover_lote: {
        Args: {
          p_actor?: string
          p_circuito: string
          p_destino: number
          p_erp_product_id: number
          p_origen: number
          p_ref?: string
          p_unidades: number
        }
        Returns: number
      }
      promociones_cerrar_meses_de_laboratorio: { Args: never; Returns: number }
      promociones_ciclo_diario: { Args: never; Returns: string }
      promociones_registrar_excedentes: { Args: never; Returns: number }
      publicar_horarios_de_sala: {
        Args: { p_branch_id: number; p_week_start: string }
        Returns: number
      }
      publish_stock_params: {
        Args: {
          p_erp_product_ids?: number[]
          p_erp_sucursal_id?: number
          p_published_by?: string
        }
        Returns: Json
      }
      puede_aprobar_modulo: {
        Args: { p_employee_id: string; p_module_key: string }
        Returns: boolean
      }
      puede_confirmar_traslado: {
        Args: { p_employee_id: string }
        Returns: boolean
      }
      puede_entregar_de: {
        Args: { p_branch_id: number; p_employee_id: string }
        Returns: boolean
      }
      puede_enviar_producto: {
        Args: { p_employee_id: string }
        Returns: boolean
      }
      puntos_acumular: {
        Args: {
          p_desde: string
          p_hasta: string
          p_margen?: number
          p_simular?: boolean
          p_tope?: number
        }
        Returns: Json
      }
      puntos_ajustar: {
        Args: {
          p_customer_id: number
          p_motivo: string
          p_nota?: string
          p_puntos: number
        }
        Returns: Json
      }
      puntos_anotar_aplicado: { Args: { p_filas: Json }; Returns: number }
      puntos_anotar_devolucion: {
        Args: {
          p_devueltos: number
          p_invoice_id: number
          p_no_recuperados: number
        }
        Returns: undefined
      }
      puntos_anular_venta: {
        Args: { p_invoice_id: number; p_simular?: boolean }
        Returns: Json
      }
      puntos_archivo_cerrar: { Args: { p_carga: number }; Returns: Json }
      puntos_asignar_cuenta_anterior: {
        Args: {
          p_customer_id: number
          p_id_cliente: number
          p_nota: string
          p_por?: string
          p_simular?: boolean
        }
        Returns: Json
      }
      puntos_barrer_anulaciones: {
        Args: {
          p_desde: string
          p_hasta: string
          p_simular?: boolean
          p_tope?: number
        }
        Returns: Json
      }
      puntos_barrer_canjes: {
        Args: {
          p_desde: string
          p_hasta: string
          p_simular?: boolean
          p_tope?: number
        }
        Returns: Json
      }
      puntos_cliente_por_documento: {
        Args: { p_documento: string; p_telefono?: string }
        Returns: {
          dui: string
          id: number
          name: string
        }[]
      }
      puntos_cliente_por_dui_y_telefono: {
        Args: { p_dui: string; p_telefono: string }
        Returns: {
          dui: string
          id: number
          name: string
        }[]
      }
      puntos_codigo_emitir: { Args: { p_customer_id: number }; Returns: Json }
      puntos_codigo_estado: { Args: { p_customer_id: number }; Returns: Json }
      puntos_codigo_ver: { Args: { p_customer_id: number }; Returns: Json }
      puntos_consulta_registrar: {
        Args: { p_acerto: boolean; p_huella_dui: string; p_ip: string }
        Returns: number
      }
      puntos_consumir: {
        Args: { p_customer_id: number; p_puntos: number; p_salida_id: number }
        Returns: number
      }
      puntos_cuadrar: {
        Args: { p_corregir?: boolean; p_customer_id?: number }
        Returns: Json
      }
      puntos_dar_cumpleanos: {
        Args: { p_dia?: string; p_simular?: boolean }
        Returns: Json
      }
      puntos_desde_efectivo: { Args: { p_desde: string }; Returns: string }
      puntos_devolver_canjes_anulados: {
        Args: {
          p_desde: string
          p_hasta: string
          p_simular?: boolean
          p_tope?: number
        }
        Returns: Json
      }
      puntos_dui_estricto: { Args: { p_dui: string }; Returns: boolean }
      puntos_encender: {
        Args: { p_base_url: string; p_inicio: string; p_simular?: boolean }
        Returns: Json
      }
      puntos_estado_cuenta: { Args: { p_customer_id: number }; Returns: Json }
      puntos_fuente: { Args: never; Returns: string }
      puntos_guardar_consentimiento: {
        Args: {
          p_customer_id: number
          p_identificado_por?: string
          p_origen?: string
          p_programa?: boolean
          p_promociones?: boolean
          p_texto_programa?: string
          p_texto_promos?: string
          p_version_aviso?: string
        }
        Returns: Json
      }
      puntos_marcar_anuladas: {
        Args: { p_invoice_ids: number[] }
        Returns: number
      }
      puntos_marcar_enviadas: {
        Args: { p_invoice_ids: number[] }
        Returns: number
      }
      puntos_marcar_revertidas: {
        Args: { p_invoice_ids: number[]; p_reversion: string }
        Returns: number
      }
      puntos_marcar_sin_enviar: {
        Args: { p_desde: string; p_hasta: string }
        Returns: number
      }
      puntos_migrar: {
        Args: { p_filas: Json; p_ganado_el?: string; p_simular?: boolean }
        Returns: Json
      }
      puntos_migrar_historial: {
        Args: {
          p_despues_de?: number
          p_limite?: number
          p_simular?: boolean
          p_solo_cliente?: number
        }
        Returns: Json
      }
      puntos_panel_asignar: {
        Args: {
          p_customer_id: number
          p_id_cliente: number
          p_nota: string
          p_simular?: boolean
        }
        Returns: Json
      }
      puntos_panel_avisos: { Args: never; Returns: Json }
      puntos_panel_candidatas: {
        Args: { p_busqueda?: string; p_id_cliente: number }
        Returns: Json
      }
      puntos_panel_cliente: { Args: { p_customer_id: number }; Returns: Json }
      puntos_panel_clientes: {
        Args: {
          p_busqueda?: string
          p_desde?: number
          p_dir?: string
          p_limite?: number
          p_orden?: string
        }
        Returns: Json
      }
      puntos_panel_pendientes: { Args: never; Returns: Json }
      puntos_panel_resumen: { Args: never; Returns: Json }
      puntos_panel_serie: { Args: { p_dias?: number }; Returns: Json }
      puntos_panel_tablero: { Args: never; Returns: Json }
      puntos_registrar_canje: {
        Args: { p_invoice_id: number; p_simular?: boolean }
        Returns: Json
      }
      puntos_sellar_estado: {
        Args: { p_desde: string; p_hasta: string }
        Returns: Json
      }
      puntos_sembrar_desde_destino: { Args: { p_filas: Json }; Returns: number }
      puntos_sincronizar_cuenta_anterior: {
        Args: {
          p_carga: number
          p_como: string
          p_customer_id: number
          p_id_cliente: number
          p_nota?: string
          p_por?: string
        }
        Returns: Json
      }
      puntos_tickets_de_ficha_que_no_acumula: {
        Args: { p_tope?: number }
        Returns: Json
      }
      puntos_vence_el: { Args: { p_ganado_el: string }; Returns: string }
      puntos_vencer_lotes: {
        Args: { p_al_dia?: string; p_simular?: boolean }
        Returns: Json
      }
      puntos_ventas_anuladas: { Args: { p_tope?: number }; Returns: Json }
      purgar_carnes_temporales: { Args: never; Returns: number }
      purgar_cola_impresion: { Args: never; Returns: number }
      purge_idle_sessions: { Args: never; Returns: number }
      push_de_notificaciones: { Args: { p_ids: string[] }; Returns: number }
      push_function_headers: { Args: never; Returns: Json }
      push_function_url: { Args: never; Returns: string }
      quien_cubre_al_empleado: {
        Args: { p_employee_id: string }
        Returns: {
          employee_id: string
          employee_name: string
          via: string
        }[]
      }
      quitar_extra_de_pedido: {
        Args: { p_item_id: number }
        Returns: undefined
      }
      quitar_renglon: { Args: { p_renglon_id: number }; Returns: Json }
      rango_de_empleado: { Args: { p_employee_id: string }; Returns: number }
      reabrir_corte_caja: {
        Args: { p_id: number; p_motivo: string }
        Returns: {
          branch_id: number
          caja_erp: number | null
          capturado_at: string
          cobros_portal_efectivo: number
          created_at: string
          desfase_seg: number | null
          diferencia_erp: number
          empleado_texto: string | null
          employee_id: string | null
          entrega: string | null
          erp_corte_id: number
          esperado: number | null
          estado: string
          fecha: string
          hora: string
          id: number
          motivo_descarte: string | null
          observaciones: string | null
          pdf_doc_ccf: number | null
          pdf_doc_factura: number | null
          pdf_doc_tiquete: number | null
          pdf_doc_total: number | null
          pdf_texto: string | null
          recibido_at: string | null
          recibido_por: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          sin_entrega_motivo: string | null
          ticket: string | null
          tipo: string
          tk_cobros_credito: number | null
          tk_credito: number | null
          tk_devoluciones: number | null
          tk_efectivo: number | null
          tk_ingresos: number | null
          tk_retencion: number | null
          tk_saldo_caja_chica: number | null
          tk_saldo_inicial: number | null
          tk_subtotal: number | null
          tk_tarjeta: number | null
          tk_total_caja: number | null
          tk_vales: number | null
          tk_venta: number | null
          total_declarado: number
          turno: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reabrir_mes_bitacora: {
        Args: { p_branch_id: number; p_motivo: string; p_periodo: string }
        Returns: number
      }
      reabrir_periodo_fiscal: {
        Args: { p_motivo: string; p_periodo: string }
        Returns: Json
      }
      rebuild_product_sales_monthly_agg: {
        Args: { p_desde: string; p_hasta: string }
        Returns: number
      }
      recalcular_estado_receta: {
        Args: { p_receta_id: number }
        Returns: string
      }
      recalcular_propuestas_metas: {
        Args: { p_motivo: string; p_year_month: string }
        Returns: number
      }
      recalcular_totales_conteo: {
        Args: { p_conteo_id: string }
        Returns: undefined
      }
      receive_pedido_sucursal: {
        Args: {
          p_items: Json
          p_pedido_id: string
          p_received_by?: string
          p_sucursal_id: number
        }
        Returns: undefined
      }
      recepciones_por_reintentar: {
        Args: { p_minutos?: number }
        Returns: {
          erp_sucursal_id: number
          pedido_id: string
          sin_ingresar: number
        }[]
      }
      recibir_bolsas: { Args: { p_ids: number[] }; Returns: number }
      reclamar_factura_compra: {
        Args: { p_branch_id: number; p_document_id: number }
        Returns: number
      }
      reclamar_impresion:
        | {
            Args: { p_device: string; p_token: string }
            Returns: {
              contenido_b64: string
              id: number
              impresora: string
              titulo: string
            }[]
          }
        | {
            Args: {
              p_canal: string
              p_device: string
              p_token: string
              p_version: string
            }
            Returns: {
              contenido_b64: string
              id: number
              impresora: string
              titulo: string
            }[]
          }
      reclamar_push_del_equipo: {
        Args: { p_auth: string; p_endpoint: string; p_p256dh: string }
        Returns: undefined
      }
      reclamar_solicitud: {
        Args: { p_lease_seconds?: number; p_request_id: string }
        Returns: boolean
      }
      reconstruir_costo_de_venta: {
        Args: { p_desde: string; p_hasta: string; p_limite?: number }
        Returns: number
      }
      recontar_conteo_item: {
        Args: { p_fisico_cantidad: number; p_item_id: string; p_nota?: string }
        Returns: Json
      }
      recontar_docs_proveedor: {
        Args: { p_proveedor_id: number }
        Returns: number
      }
      recordar_linea_base_de_egreso: { Args: never; Returns: number }
      refresh_customer_activity: { Args: never; Returns: Json }
      refresh_inventory_grouped_mv: { Args: never; Returns: undefined }
      refresh_primera_venta_producto: { Args: never; Returns: undefined }
      refresh_product_last_sale: { Args: never; Returns: Json }
      refresh_product_sales_monthly_agg: {
        Args: { p_months_back?: number }
        Returns: number
      }
      refresh_product_sales_rollup: { Args: never; Returns: Json }
      refresh_sales_daily_stats: {
        Args: { p_days_back?: number }
        Returns: number
      }
      registrar_bitacora: {
        Args: {
          p_action: string
          p_branch_id?: string
          p_branch_name?: string
          p_details?: Json
          p_device_name?: string
          p_input_method?: string
          p_severity?: string
          p_source?: string
          p_target_id?: string
          p_user_name?: string
        }
        Returns: Json
      }
      registrar_caja_de_impresion: {
        Args: { p_branch_id: number; p_impresora?: string; p_nombre: string }
        Returns: {
          id: string
          token: string
        }[]
      }
      registrar_deposito_bancario: {
        Args: {
          p_aporte?: number
          p_aporte_nota?: string
          p_banco_id?: number
          p_bolsa_ids: number[]
          p_destino?: string
          p_entregado_a?: string
          p_llevado_por?: string
          p_monto: number
          p_monto_efectivo?: number
          p_nota?: string
        }
        Returns: {
          anulado_at: string | null
          anulado_motivo: string | null
          anulado_por: string | null
          aporte: number
          aporte_nota: string | null
          banco_id: number | null
          cerrado_at: string
          cerrado_por: string | null
          comprobante_url: string | null
          created_at: string
          destino: string
          entregado_a: string | null
          fecha: string
          folio: string
          id: number
          llevado_por: string | null
          monto_deposito: number
          monto_efectivo: number
          nota: string | null
          remanente: number
          remanente_entregado_por: string | null
          remanente_recibido_por: string | null
          total_contado: number
        }
        SetofOptions: {
          from: "*"
          to: "depositos_bancarios"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_egreso: {
        Args: {
          p_detalle?: Json
          p_filas?: number
          p_formato?: string
          p_modulo: string
        }
        Returns: string
      }
      registrar_lectura_bitacora: {
        Args: {
          p_accion?: string
          p_area_id: number
          p_fecha: string
          p_franja: string
          p_humedad?: number
          p_temperatura: number
        }
        Returns: number
      }
      registrar_limpieza_bitacora: {
        Args: {
          p_area_id: number
          p_fecha: string
          p_observaciones?: string
          p_puntos?: Json
          p_turno: string
        }
        Returns: number
      }
      registrar_pago_compra: {
        Args: {
          p_aplicaciones: Json
          p_emisor_nit: string
          p_fecha: string
          p_forma: string
          p_nota?: string
          p_referencia: string
        }
        Returns: number
      }
      registrar_rectificacion: {
        Args: { p_employee_id: string; p_fecha?: string; p_nota?: string }
        Returns: string
      }
      registrar_renglones_pendientes: {
        Args: {
          p_document_id: number
          p_emisor_nit: string
          p_fecha: string
          p_filas: Json
        }
        Returns: number
      }
      registrar_ronda_bitacora: { Args: { p_items: Json }; Returns: Json }
      registrar_salida_de_bolsa: {
        Args: {
          p_entidad?: string
          p_foto_url?: string
          p_metodo?: string
          p_monto: number
          p_nota?: string
          p_numero_boleta?: string
          p_recibido_por?: string
          p_repartos: Json
          p_tipo: string
          p_vale?: string
        }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          created_at: string
          entidad: string | null
          folio: string
          foto_lectura: Json | null
          foto_url: string | null
          id: number
          monto: number
          monto_origen: string | null
          nota: string | null
          numero_boleta: string | null
          recibido_metodo: string | null
          recibido_por: string | null
          registrado_at: string
          registrado_por: string | null
          tipo: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas_operaciones"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      registrar_sancion: {
        Args: {
          p_autorizacion?: string
          p_dias?: number
          p_employee_id: string
          p_falta: string
          p_fecha: string
          p_nota?: string
          p_peldano: number
        }
        Returns: string
      }
      registrar_traslados_erp: { Args: { p_lineas: Json }; Returns: number }
      regrant_employees_columns: { Args: never; Returns: string }
      reject_minmax_request: {
        Args: { p_decided_by?: string; p_note?: string; p_request_id: number }
        Returns: Json
      }
      reservar_pago_bono: { Args: { p_item: string }; Returns: Json }
      resolve_pedido_item: {
        Args: {
          p_action: string
          p_item_id: number
          p_nota?: string
          p_tipo?: string
          p_user_id?: string
        }
        Returns: undefined
      }
      resolve_purchase_dte_review: {
        Args: {
          p_action: string
          p_matched_document_id?: number
          p_review_id: number
        }
        Returns: undefined
      }
      resolver_carne_temporal: { Args: { p_valor: string }; Returns: string }
      resolver_clasificacion_pendiente: {
        Args: {
          p_clasificacion?: number
          p_ids: number[]
          p_iva_deducible: boolean
          p_sector?: number
          p_tipo_costo_gasto?: number
          p_tipo_operacion?: number
        }
        Returns: number
      }
      resolver_corte_caja: {
        Args: {
          p_estado: string
          p_id: number
          p_motivo?: string
          p_observaciones?: string
          p_recibido_por?: string
          p_sin_entrega_motivo?: string
          p_vale?: string
        }
        Returns: {
          branch_id: number
          caja_erp: number | null
          capturado_at: string
          cobros_portal_efectivo: number
          created_at: string
          desfase_seg: number | null
          diferencia_erp: number
          empleado_texto: string | null
          employee_id: string | null
          entrega: string | null
          erp_corte_id: number
          esperado: number | null
          estado: string
          fecha: string
          hora: string
          id: number
          motivo_descarte: string | null
          observaciones: string | null
          pdf_doc_ccf: number | null
          pdf_doc_factura: number | null
          pdf_doc_tiquete: number | null
          pdf_doc_total: number | null
          pdf_texto: string | null
          recibido_at: string | null
          recibido_por: string | null
          resuelto_at: string | null
          resuelto_por: string | null
          sin_entrega_motivo: string | null
          ticket: string | null
          tipo: string
          tk_cobros_credito: number | null
          tk_credito: number | null
          tk_devoluciones: number | null
          tk_efectivo: number | null
          tk_ingresos: number | null
          tk_retencion: number | null
          tk_saldo_caja_chica: number | null
          tk_saldo_inicial: number | null
          tk_subtotal: number | null
          tk_tarjeta: number | null
          tk_total_caja: number | null
          tk_vales: number | null
          tk_venta: number | null
          total_declarado: number
          turno: number | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolver_destinatarios_traslado: {
        Args: { p_branch_id: number }
        Returns: {
          destinatarios: string[]
          escalon: string
        }[]
      }
      resolver_diferencia_bolsa: {
        Args: {
          p_causa: string
          p_foto_url?: string
          p_id: number
          p_via: string
        }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          branch_id: number
          caja: string | null
          cerrada_at: string
          cerrada_por: string | null
          contado: number | null
          contado_at: string | null
          contado_por: string | null
          conteo_id: number | null
          conteo_marcado: number | null
          conteo_marcado_at: string | null
          conteo_marcado_por: string | null
          corte_id: number | null
          created_at: string
          deposito_id: number | null
          dif_at: string | null
          dif_causa: string | null
          dif_foto_url: string | null
          dif_por: string | null
          dif_via: string | null
          entrega_id: number | null
          entregada_at: string | null
          entregada_por: string | null
          estado: string
          etiqueta_impresa_at: string | null
          etiqueta_version: number
          fecha: string
          folio: string
          hora: string
          id: number
          monto_inicial: number
          motivo_origen: string | null
          origen: string
          recibida_at: string | null
          recibida_por: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "bolsas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolver_diferencia_corte: {
        Args: {
          p_causa: string
          p_corte_id: number
          p_evidencia_foto?: string
          p_evidencia_ref?: string
          p_monto?: number
          p_monto_esperado: number
          p_personas?: Json
          p_via: string
        }
        Returns: {
          anulada_at: string | null
          anulada_motivo: string | null
          anulada_por: string | null
          asentado_at: string | null
          asentado_por: string | null
          asentado_ref: string | null
          branch_id: number
          causa: string
          corte_id: number
          created_at: string
          evidencia_foto_url: string | null
          evidencia_ref: string | null
          fecha: string
          id: number
          impreso_at: string | null
          monto: number
          registrado_at: string
          registrado_por: string | null
          updated_at: string
          via: string
        }
        SetofOptions: {
          from: "*"
          to: "cortes_caja_diferencias"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolver_reclamo_sancion: {
        Args: { p_estado: string; p_evento_id: string; p_resolucion?: string }
        Returns: undefined
      }
      resumen_de_promocion: { Args: { p_id: number }; Returns: Json }
      resumen_ingreso_pedidos: {
        Args: { p_pedido_ids: string[] }
        Returns: {
          con_error: number
          erp_sucursal_id: number
          ingresadas: number
          lineas: number
          pedido_id: string
          sin_ingresar: number
        }[]
      }
      resumen_traslado_pedido: {
        Args: { p_pedido_id: string; p_sucursal_id: number }
        Returns: Json
      }
      resumen_ventas_diario: {
        Args: { p_branch_id: number; p_desde: string; p_hasta: string }
        Returns: {
          documentos: number
          fecha: string
          tipo_documento: string
          total: number
        }[]
      }
      retirar_avisos_ccf_ya_sellados: { Args: never; Returns: number }
      retiro_abierto: { Args: never; Returns: Json }
      retiro_bultos_viejos: { Args: { p_dias?: number }; Returns: Json }
      retiro_cargar: {
        Args: { p_entrego_id?: string; p_request_id: string }
        Returns: Json
      }
      retiro_cerrar: { Args: never; Returns: Json }
      retiro_firmar: { Args: { p_entrego_id: string }; Returns: Json }
      retiro_firmar_carne: { Args: { p_valor: string }; Returns: Json }
      retiro_pendientes_en_sala: {
        Args: { p_branch_id: number }
        Returns: Json
      }
      retiro_soltar: { Args: { p_request_id: string }; Returns: Json }
      revoke_person_sessions: { Args: { p_user_id: string }; Returns: number }
      revoke_session: { Args: { p_session_id: string }; Returns: boolean }
      sala_abierta_ahora: { Args: { p_branch_id: number }; Returns: boolean }
      sala_con_caja_abierta: { Args: { p_branch_id: number }; Returns: boolean }
      sala_hora_de_cierre: {
        Args: { p_branch: number; p_dia: string }
        Returns: string
      }
      sala_ya_cerro: {
        Args: { p_branch: number; p_momento?: string }
        Returns: boolean
      }
      salas_con_caja_de_impresion: {
        Args: never
        Returns: {
          branch_id: number
          latiendo: boolean
          ultimo_latido: string
        }[]
      }
      salas_que_cubre_ahora: {
        Args: { p_branch_id: number }
        Returns: number[]
      }
      salas_que_cubro_ahora: { Args: never; Returns: number[] }
      save_pedido_snapshot: {
        Args: { p_nombre: string; p_sucursal_ids: number[] }
        Returns: string
      }
      search_inventory_descripcion_ids: {
        Args: { p_erp_sucursal_id?: number; p_search: string }
        Returns: {
          id: number
        }[]
      }
      search_ventas_ids: {
        Args: { p_ffin?: string; p_fini?: string; p_search: string }
        Returns: {
          aproximado: boolean
          id: number
        }[]
      }
      sec_avisa: { Args: { p_key: string }; Returns: boolean }
      sec_exige: { Args: { p_key: string }; Returns: boolean }
      seleccionar_muestra_ciclica: {
        Args: { p_branch_id: number; p_tamano?: number }
        Returns: {
          erp_product_id: number
          segmento: string
          ultimo_conteo: string
        }[]
      }
      sello_mh_valido: { Args: { p_sello: string }; Returns: boolean }
      session_idle_limit_minutes: {
        Args: { p_device_class: string; p_user_id: string }
        Returns: number
      }
      set_banner_portal: {
        Args: {
          p_activo: boolean
          p_texto?: string
          p_texto_corto?: string
          p_variante?: string
        }
        Returns: Json
      }
      set_bonificaciones_metas: {
        Args: { p_activas: boolean; p_solo_este_mes?: boolean }
        Returns: Json
      }
      set_kiosk_pin: {
        Args: { p_employee_id: string; p_pin: string }
        Returns: undefined
      }
      set_numero_control_batch: {
        Args: { p_ids: number[]; p_numeros: string[] }
        Returns: number
      }
      set_proveedor_categoria: {
        Args: { p_categoria_id: number; p_id: number }
        Returns: undefined
      }
      set_proveedor_clasificacion_fiscal: {
        Args: {
          p_clasificacion?: number
          p_id: number
          p_iva_deducible: boolean
          p_nota?: string
          p_sector?: number
          p_tipo_costo_gasto?: number
          p_tipo_operacion?: number
        }
        Returns: undefined
      }
      set_proveedor_condiciones_credito: {
        Args: {
          p_dias_credito: number
          p_forma_pago: string
          p_id: number
          p_limite_credito: number
        }
        Returns: undefined
      }
      set_proveedor_supplier: {
        Args: { p_id: number; p_supplier_id: number }
        Returns: undefined
      }
      set_proveedores_categoria_bulk: {
        Args: { p_categoria_id: number; p_ids: number[] }
        Returns: number
      }
      set_purchase_dte_proveedor: {
        Args: { p_document_id: number; p_proveedor_id: number }
        Returns: undefined
      }
      set_traslado_interruptor: {
        Args: { p_accion: string; p_motivo?: string; p_pausado: boolean }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      siguiente_folio_de_abono: {
        Args: { p_branch_id: number }
        Returns: string
      }
      sincronizar_bitacora_dispensaciones: {
        Args: { p_branch_id?: number; p_desde: string; p_hasta: string }
        Returns: Json
      }
      sincronizar_conteo_en_vivo: {
        Args: { p_conteo_id: string }
        Returns: Json
      }
      solicitar_devolucion_pedido: {
        Args: {
          p_cantidad: number
          p_evidencia?: Json
          p_motivo: string
          p_nota?: string
          p_pedido_item_id: number
        }
        Returns: Json
      }
      solicitud_datos_tomar_folio: { Args: { p_anio: number }; Returns: number }
      soltar_factura_compra: {
        Args: { p_claim_id: number; p_motivo?: string }
        Returns: undefined
      }
      soltar_paso_envio: {
        Args: { p_paso: string; p_request_id: string }
        Returns: undefined
      }
      soltar_push_del_equipo: {
        Args: { p_endpoint: string }
        Returns: undefined
      }
      sucursal_en_conteo: { Args: { p_branch_id: number }; Returns: Json }
      suggest_proveedor_categoria_id: {
        Args: { p_desc_actividad: string }
        Returns: number
      }
      suspendidos_en: { Args: { p_fecha?: string }; Returns: Json }
      sync_creditos_batch: {
        Args: { p_filas: Json }
        Returns: {
          cambiadas: number
          procesadas: number
        }[]
      }
      sync_inventory_batch: {
        Args: {
          p_erp_sucursal_id: number
          p_is_vencidos: boolean
          p_rows: Json
        }
        Returns: Json
      }
      sync_laboratorios_batch: { Args: { p_rows: Json }; Returns: number }
      sync_presentaciones_batch: { Args: { p_rows: Json }; Returns: number }
      sync_purchase_receipt_items_batch: {
        Args: { p_rows: Json }
        Returns: number
      }
      sync_purchase_receipts_batch: { Args: { p_rows: Json }; Returns: number }
      sync_suppliers_batch: { Args: { p_rows: Json }; Returns: number }
      texto_de_push: {
        Args: { p_body: string; p_meta: Json; p_type: string }
        Returns: string
      }
      toggle_producto_oculto_ventas: {
        Args: { p_erp_product_id: number; p_oculto: boolean }
        Returns: undefined
      }
      tomar_despacho_envio: {
        Args: { p_actor: string; p_request_id: string }
        Returns: boolean
      }
      tomar_paso_envio: {
        Args: { p_actor: string; p_paso: string; p_request_id: string }
        Returns: boolean
      }
      tope_renglones_envio: { Args: never; Returns: number }
      touch_session: { Args: { p_device_class?: string }; Returns: undefined }
      traslado_por_codigo: { Args: { p_codigo: string }; Returns: Json }
      traslados_en_vuelo: {
        Args: never
        Returns: {
          erp_product_id: number
          erp_sucursal_id: number
          unidades: number
        }[]
      }
      traslados_en_vuelo_vencidos: {
        Args: never
        Returns: {
          erp_product_id: number
          erp_sucursal_id: number
          unidades: number
        }[]
      }
      traslados_por_barrer: {
        Args: { p_minutos?: number }
        Returns: {
          enviado_at: string
          erp_sucursal_id: number
          id_traslado: string
          producto: string
          request_id: string
        }[]
      }
      turno_del_dia: { Args: { p_dia: Json; p_turno?: Json }; Returns: Json }
      unblock_employee: { Args: { p_employee_id: string }; Returns: boolean }
      unidad_de_despacho: {
        Args: { p_ids: number[] }
        Returns: {
          erp_product_id: number
          etiqueta: string
          factor: number
          multiplo: number
          tipo: string
          unidades: number
        }[]
      }
      unlock_module: { Args: { p_module_key: string }; Returns: Json }
      update_customer_fiscal: {
        Args: { p_campos: Json; p_confirmar_fiscal?: boolean; p_id: number }
        Returns: Json
      }
      update_pedido_sucursal_lifecycle: {
        Args: {
          p_nota?: string
          p_pedido_id: string
          p_razon?: string
          p_stage: string
          p_sucursal_id: number
          p_user_id?: string
        }
        Returns: undefined
      }
      update_proveedor_manual:
        | {
            Args: {
              p_activo: boolean
              p_alias?: string
              p_contacto_nombre: string
              p_id: number
              p_nombre_cheques: string
              p_notas: string
              p_percibe_1_override?: boolean
              p_telefono2: string
            }
            Returns: undefined
          }
        | {
            Args: {
              p_activo: boolean
              p_alias?: string
              p_contacto_nombre: string
              p_id: number
              p_nombre_cheques: string
              p_notas: string
              p_percibe_1_override?: boolean
              p_retiene_renta?: boolean
              p_telefono2: string
            }
            Returns: undefined
          }
      upsert_clientes_por_revisar: { Args: { p_filas: Json }; Returns: number }
      upsert_customers: {
        Args: { names: string[] }
        Returns: {
          customer_id: number
          customer_name: string
        }[]
      }
      upsert_customers_v2: {
        Args: { p_rows: Json }
        Returns: {
          customer_id: number
          customer_name: string
        }[]
      }
      upsert_meta_manual: {
        Args: {
          p_branch_id: number
          p_monto: number
          p_nota?: string
          p_year_month: string
        }
        Returns: undefined
      }
      upsert_product_precios_batch: { Args: { p_rows: Json }; Returns: number }
      upsert_products_minimal: { Args: { p_rows: Json }; Returns: number }
      upsert_proveedor_from_dte: { Args: { p_data: Json }; Returns: Json }
      validate_role_headcount: {
        Args: { p_branch_id: number; p_role_id: number }
        Returns: boolean
      }
      venta_fiscal: {
        Args: { p_estado: string; p_recibido_mh: string }
        Returns: boolean
      }
      venta_valida: { Args: { p_estado: string }; Returns: boolean }
      ventas_busqueda_aproximada: {
        Args: { p_ffin?: string; p_fini?: string; p_search: string }
        Returns: boolean
      }
      ventas_elegibles_puntos: {
        Args: {
          p_desde: string
          p_hasta: string
          p_margen?: number
          p_tope?: number
        }
        Returns: Json
      }
      ventas_para_puntos: {
        Args: {
          p_desde: string
          p_hasta: string
          p_margen?: number
          p_reevaluar?: boolean
          p_tope?: number
        }
        Returns: Json
      }
      ventas_por_mes_de_producto: {
        Args: { p_branch_id: number; p_erp_product_id: number }
        Returns: Json
      }
      verificar_facturas_reclamadas: {
        Args: { p_ventana_dias?: number }
        Returns: number
      }
      verificar_hojas_pedido: {
        Args: { p_pedido_id: string; p_sucursal_id: number }
        Returns: Json
      }
      verificar_persona: {
        Args: { p_employee_id: string; p_metodo: string; p_secreto: string }
        Returns: boolean
      }
      verify_kiosk_authorization: {
        Args: {
          p_code: string
          p_device_id: string
          p_device_token: string
          p_employee_id: string
        }
        Returns: Json
      }
      verify_kiosk_device: {
        Args: { p_device_id: string; p_device_token: string }
        Returns: {
          branch_id: number
          status: string
        }[]
      }
      verify_kiosk_pin: {
        Args: {
          p_device_id: string
          p_device_token: string
          p_employee_id: string
          p_pin: string
        }
        Returns: Json
      }
      vigilar_reinicio_de_la_base: { Args: never; Returns: undefined }
      zero_out_product_all_branches: {
        Args: { p_erp_product_id: number; p_motivo?: string; p_nota?: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
