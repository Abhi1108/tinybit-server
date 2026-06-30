/**
 * @openapi
 * tags:
 *   - name: Doctors
 *     description: Doctor directory (public)
 *
 * /api/doctors:
 *   get:
 *     tags: [Doctors]
 *     summary: List doctors
 *     parameters:
 *       - in: query
 *         name: specialty
 *         schema:
 *           type: string
 *         description: Filter by specialty
 *     responses:
 *       200:
 *         description: Doctor list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 doctors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       specialty:
 *                         type: string
 *                       rating:
 *                         type: number
 *                       experience:
 *                         type: string
 *                       fee:
 *                         type: string
 *                       address:
 *                         type: string
 *                       hospital:
 *                         type: string
 *                       phone:
 *                         type: string
 *                       email:
 *                         type: string
 *                       about:
 *                         type: string
 *                       image_url:
 *                         type: string
 *                       is_active:
 *                         type: boolean
 *                       sort_order:
 *                         type: integer
 *
 * /api/doctors/{id}:
 *   get:
 *     tags: [Doctors]
 *     summary: Get doctor by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Doctor detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 doctor:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     specialty:
 *                       type: string
 *                     rating:
 *                       type: number
 *                     experience:
 *                       type: string
 *                     fee:
 *                       type: string
 *                     address:
 *                       type: string
 *                     hospital:
 *                       type: string
 *                     phone:
 *                       type: string
 *                     email:
 *                       type: string
 *                     about:
 *                       type: string
 *                     image_url:
 *                       type: string
 *                     is_active:
 *                       type: boolean
 *                     sort_order:
 *                       type: integer
 *       404:
 *         description: Doctor not found
 */

module.exports = {};
